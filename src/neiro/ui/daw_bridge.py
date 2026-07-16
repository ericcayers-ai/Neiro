"""DAW injector bridge — one shared Neiro window for every plugin instance.

Plugin instances (VST/CLAP inserts on DAW tracks) are thin injectors: they
register with this module, optionally stream audio/MIDI, and when the user
opens the plugin editor they do **not** embed a second UI. Instead they call
:func:`request_show_ui`, which bumps a focus sequence the desktop/browser
client polls. The client brings the *single* Neiro window forward and switches
to the requested module (any worksuite mode) for that instance.

Audio can be captured from the insert (Edison-style arm/record/stop) and posted
to ``/api/daw/capture``, which registers a normal Neiro file and bumps
``capture_seq`` so the shared window loads it for Separate / Restore /
Transcribe / etc.

This is the "one activate open window for all functions" contract: N inserts
in the DAW, one Neiro surface.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

__all__ = [
    "ALLOWED_MODULES",
    "normalize_module",
    "DawInstance",
    "DawMidiEvent",
    "DawBridgeState",
    "default_bridge",
]

_MAX_MIDI = 256
_STALE_SECONDS = 120.0

# Every worksuite ModuleId — VST show-ui / capture may target any of these.
ALLOWED_MODULES: frozenset[str] = frozenset(
    {
        "import",
        "analysis",
        "studio",
        "separate",
        "restore",
        "transcribe",
        "mixer",
        "learn",
        "preferences",
        "about",
    }
)

# Default after Edison-style capture: send the clip into preprocess (Separate).
_DEFAULT_CAPTURE_MODULE = "separate"
_DEFAULT_FOCUS_MODULE = "learn"


def normalize_module(module: str | None, *, default: str = _DEFAULT_FOCUS_MODULE) -> str:
    m = (module or default).strip().lower()
    return m if m in ALLOWED_MODULES else default


@dataclass
class DawMidiEvent:
    pitch: int
    velocity: int
    note_on: bool
    t_mono: float
    instance_id: str
    seq: int = 0


@dataclass
class DawInstance:
    instance_id: str
    track_name: str = "DAW track"
    plugin_role: str = "injector"  # injector | learn | capture
    host: str = "unknown"
    sample_rate: int = 44100
    channels: int = 2
    created_at: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)
    active: bool = True
    learn_armed: bool = True
    recording: bool = False
    frames_captured: int = 0
    last_peak: float = 0.0
    preferred_module: str = _DEFAULT_FOCUS_MODULE
    last_capture_file_id: str | None = None

    def touch(self) -> None:
        self.last_seen = time.monotonic()
        self.active = True

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        d["age_seconds"] = round(time.monotonic() - self.created_at, 2)
        d["idle_seconds"] = round(time.monotonic() - self.last_seen, 2)
        return d


class DawBridgeState:
    """Process-wide registry for DAW plugin injectors."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._instances: dict[str, DawInstance] = {}
        self._focus_instance: str | None = None
        self._focus_seq: int = 0
        self._focus_module: str = _DEFAULT_FOCUS_MODULE
        self._midi: list[DawMidiEvent] = []
        self._midi_seq: int = 0
        self._capture_seq: int = 0
        self._last_capture: dict[str, Any] | None = None
        self._launch_requested: bool = False
        self._browser_opened: bool = False

    # -- instances -----------------------------------------------------------
    def register(
        self,
        *,
        track_name: str = "DAW track",
        plugin_role: str = "injector",
        host: str = "unknown",
        sample_rate: int = 44100,
        channels: int = 2,
        instance_id: str | None = None,
        preferred_module: str | None = None,
    ) -> DawInstance:
        with self._lock:
            self._gc_locked()
            iid = instance_id or f"daw-{uuid.uuid4().hex[:10]}"
            pref = normalize_module(preferred_module, default=_DEFAULT_FOCUS_MODULE)
            if iid in self._instances:
                inst = self._instances[iid]
                inst.track_name = track_name or inst.track_name
                inst.plugin_role = plugin_role or inst.plugin_role
                inst.host = host or inst.host
                inst.sample_rate = int(sample_rate) or inst.sample_rate
                inst.channels = int(channels) or inst.channels
                if preferred_module is not None:
                    inst.preferred_module = pref
                inst.touch()
                return inst
            inst = DawInstance(
                instance_id=iid,
                track_name=track_name,
                plugin_role=plugin_role,
                host=host,
                sample_rate=int(sample_rate),
                channels=int(channels),
                preferred_module=pref,
            )
            self._instances[iid] = inst
            return inst

    def unregister(self, instance_id: str) -> bool:
        with self._lock:
            gone = self._instances.pop(instance_id, None) is not None
            if self._focus_instance == instance_id:
                self._focus_instance = next(iter(self._instances), None)
            return gone

    def heartbeat(
        self,
        instance_id: str,
        *,
        peak: float | None = None,
        frames: int = 0,
        recording: bool | None = None,
        preferred_module: str | None = None,
    ) -> bool:
        with self._lock:
            inst = self._instances.get(instance_id)
            if inst is None:
                return False
            inst.touch()
            if peak is not None:
                inst.last_peak = float(peak)
            if frames:
                inst.frames_captured += int(frames)
            if recording is not None:
                inst.recording = bool(recording)
            if preferred_module is not None:
                inst.preferred_module = normalize_module(
                    preferred_module, default=inst.preferred_module
                )
            return True

    def list_instances(self) -> list[dict[str, Any]]:
        with self._lock:
            self._gc_locked()
            return [i.to_public() for i in self._instances.values()]

    # -- shared window focus -------------------------------------------------
    def request_show_ui(
        self,
        instance_id: str | None = None,
        *,
        module: str = _DEFAULT_FOCUS_MODULE,
        launch_if_needed: bool = True,
    ) -> dict[str, Any]:
        """Bump the focus sequence so the single Neiro window comes forward."""
        with self._lock:
            self._gc_locked()
            mod = normalize_module(module, default=_DEFAULT_FOCUS_MODULE)
            if instance_id and instance_id in self._instances:
                self._focus_instance = instance_id
                self._instances[instance_id].touch()
                self._instances[instance_id].learn_armed = True
                self._instances[instance_id].preferred_module = mod
            elif self._instances:
                self._focus_instance = next(iter(self._instances))
            self._focus_module = mod
            self._focus_seq += 1
            if launch_if_needed:
                self._launch_requested = True
            return self.status_locked()

    def consume_launch_request(self) -> bool:
        """Return True once per process when a browser open is still needed."""
        with self._lock:
            if not self._launch_requested or self._browser_opened:
                self._launch_requested = False
                return False
            self._launch_requested = False
            self._browser_opened = True
            return True

    # -- Edison-style capture ------------------------------------------------
    def publish_capture(
        self,
        instance_id: str | None,
        *,
        file_payload: dict[str, Any],
        module: str | None = None,
        launch_if_needed: bool = True,
    ) -> dict[str, Any]:
        """Register a finished capture and focus the shared window on it."""
        with self._lock:
            self._gc_locked()
            mod = normalize_module(module, default=_DEFAULT_CAPTURE_MODULE)
            if instance_id and instance_id in self._instances:
                inst = self._instances[instance_id]
                inst.touch()
                inst.recording = False
                inst.last_capture_file_id = str(file_payload.get("file_id") or "") or None
                inst.preferred_module = mod
                self._focus_instance = instance_id
            elif self._instances:
                self._focus_instance = next(iter(self._instances))
            self._capture_seq += 1
            self._last_capture = {
                **file_payload,
                "instance_id": instance_id,
                "module": mod,
                "capture_seq": self._capture_seq,
            }
            self._focus_module = mod
            self._focus_seq += 1
            if launch_if_needed:
                self._launch_requested = True
            return self.status_locked()

    # -- MIDI (Learn wait mode from DAW) -------------------------------------
    def push_midi(
        self,
        instance_id: str,
        *,
        pitch: int,
        velocity: int = 100,
        note_on: bool = True,
    ) -> dict[str, Any]:
        with self._lock:
            if instance_id not in self._instances:
                raise KeyError(instance_id)
            self._instances[instance_id].touch()
            self._midi_seq += 1
            ev = DawMidiEvent(
                pitch=int(pitch) & 0x7F,
                velocity=max(0, min(127, int(velocity))),
                note_on=bool(note_on),
                t_mono=time.monotonic(),
                instance_id=instance_id,
                seq=self._midi_seq,
            )
            self._midi.append(ev)
            if len(self._midi) > _MAX_MIDI:
                self._midi = self._midi[-_MAX_MIDI:]
            return {"ok": True, "midi_seq": self._midi_seq, "event": asdict(ev)}

    def poll_midi(self, after_seq: int = 0) -> dict[str, Any]:
        with self._lock:
            events = [asdict(e) for e in self._midi if e.seq > after_seq]
            return {
                "midi_seq": self._midi_seq,
                "events": events,
                "focus_instance": self._focus_instance,
            }

    # -- status --------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        with self._lock:
            return self.status_locked()

    def status_locked(self) -> dict[str, Any]:
        return {
            "connected": bool(self._instances),
            "instance_count": len(self._instances),
            "instances": [i.to_public() for i in self._instances.values()],
            "focus_instance": self._focus_instance,
            "focus_seq": self._focus_seq,
            "focus_module": self._focus_module,
            "midi_seq": self._midi_seq,
            "capture_seq": self._capture_seq,
            "last_capture": self._last_capture,
            "allowed_modules": sorted(ALLOWED_MODULES),
            "launch_requested": self._launch_requested,
            "shared_window": True,
            "contract": (
                "One Neiro window serves every DAW injector instance; "
                "plugin editors call show-ui for any mode; arm/record captures "
                "track audio into Neiro for preprocess (Separate/Restore/Transcribe)."
            ),
        }

    def _gc_locked(self) -> None:
        now = time.monotonic()
        stale = [
            iid for iid, inst in self._instances.items() if (now - inst.last_seen) > _STALE_SECONDS
        ]
        for iid in stale:
            self._instances.pop(iid, None)
        if self._focus_instance not in self._instances:
            self._focus_instance = next(iter(self._instances), None)


_BRIDGE: DawBridgeState | None = None
_BRIDGE_LOCK = threading.Lock()


def default_bridge() -> DawBridgeState:
    global _BRIDGE
    with _BRIDGE_LOCK:
        if _BRIDGE is None:
            _BRIDGE = DawBridgeState()
        return _BRIDGE
