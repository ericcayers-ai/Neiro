"""Typed artifacts exchanged between nodes.

Every value that flows through the graph is an :class:`Artifact`. Artifacts are
hashable by content-identity so the cache (see :mod:`neiro.engine.cache`) can key
results on ``hash(input hashes + node config + model version)``. Audio payloads
hash by a cheap fingerprint (shape, rate, and a strided sample of the buffer)
rather than the whole buffer, which is enough to detect change without paying to
hash hundreds of megabytes.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

__all__ = [
    "Artifact",
    "AudioTensor",
    "AnalysisReport",
    "NoteEvent",
    "NoteStream",
    "Timeline",
]


def _hash_bytes(*chunks: bytes) -> str:
    h = hashlib.sha256()
    for c in chunks:
        h.update(c)
    return h.hexdigest()[:32]


class Artifact:
    """Base class for everything that flows between nodes."""

    def content_key(self) -> str:  # pragma: no cover - overridden
        raise NotImplementedError

    def with_provenance(self, **entries: Any) -> Artifact:  # pragma: no cover
        raise NotImplementedError


@dataclass(frozen=True)
class AudioTensor(Artifact):
    """A block of audio.

    ``samples`` has shape ``(channels, frames)`` and dtype float32 in [-1, 1].
    ``provenance`` records the chain of nodes/models that produced this buffer so
    any export can be traced back to exactly what made it.
    """

    samples: np.ndarray
    sample_rate: int
    provenance: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.samples.ndim == 1:
            object.__setattr__(self, "samples", self.samples[np.newaxis, :])
        if self.samples.ndim != 2:
            raise ValueError(f"samples must be (channels, frames), got {self.samples.shape}")
        if self.samples.dtype != np.float32:
            object.__setattr__(self, "samples", self.samples.astype(np.float32))

    @property
    def channels(self) -> int:
        return self.samples.shape[0]

    @property
    def frames(self) -> int:
        return self.samples.shape[1]

    @property
    def duration_seconds(self) -> float:
        return self.frames / self.sample_rate

    def peak(self) -> float:
        return float(np.max(np.abs(self.samples))) if self.frames else 0.0

    def rms_dbfs(self) -> float:
        if not self.frames:
            return -np.inf
        rms = float(np.sqrt(np.mean(np.square(self.samples))))
        return 20.0 * np.log10(rms + 1e-12)

    def to_mono(self) -> AudioTensor:
        if self.channels == 1:
            return self
        mono = np.mean(self.samples, axis=0, keepdims=True)
        return replace(self, samples=mono.astype(np.float32))

    def with_provenance(self, entry: str) -> AudioTensor:
        return replace(self, provenance=self.provenance + (entry,))

    def content_key(self) -> str:
        a = self.samples
        # Fingerprint: shape + rate + a strided sample of the raw bytes.
        stride = max(1, a.size // 4096)
        sample = np.ascontiguousarray(a.reshape(-1)[::stride]).tobytes()
        meta = f"{a.shape}|{self.sample_rate}".encode()
        return _hash_bytes(meta, sample)


@dataclass(frozen=True)
class AnalysisReport(Artifact):
    """Structured result of the analysis pass (roadmap §4)."""

    duration_seconds: float
    sample_rate: int
    channels: int
    is_effectively_mono: bool
    integrated_lufs: float
    peak_dbfs: float
    estimated_bpm: float | None = None
    estimated_key: str | None = None
    bandwidth_hz: float | None = None
    clipping_ratio: float = 0.0
    noise_floor_dbfs: float | None = None
    instruments: tuple[dict[str, Any], ...] = ()
    vocal_conditions: dict[str, Any] = field(default_factory=dict)
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "duration_seconds": round(self.duration_seconds, 3),
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "is_effectively_mono": self.is_effectively_mono,
            "integrated_lufs": round(self.integrated_lufs, 2),
            "peak_dbfs": round(self.peak_dbfs, 2),
            "estimated_bpm": None if self.estimated_bpm is None else round(self.estimated_bpm, 1),
            "estimated_key": self.estimated_key,
            "bandwidth_hz": None if self.bandwidth_hz is None else round(self.bandwidth_hz, 1),
            "clipping_ratio": round(self.clipping_ratio, 6),
            "noise_floor_dbfs": (
                None if self.noise_floor_dbfs is None else round(self.noise_floor_dbfs, 2)
            ),
            "instruments": list(self.instruments),
            "vocal_conditions": self.vocal_conditions,
            "notes": list(self.notes),
        }

    def content_key(self) -> str:
        import json

        return _hash_bytes(json.dumps(self.as_dict(), sort_keys=True).encode())


@dataclass(frozen=True)
class NoteEvent:
    """A single transcribed note in absolute (float second) time."""

    onset: float
    offset: float
    pitch: int  # MIDI note number
    velocity: int = 80
    confidence: float = 1.0
    track: str = "default"


@dataclass(frozen=True)
class NoteStream(Artifact):
    """A collection of note events plus a tempo map, in musical-agnostic time."""

    events: tuple[NoteEvent, ...]
    tempo_bpm: float | None = None
    source: str = ""

    def content_key(self) -> str:
        payload = "|".join(
            f"{e.onset:.4f},{e.offset:.4f},{e.pitch},{e.velocity}" for e in self.events
        )
        return _hash_bytes(payload.encode(), str(self.tempo_bpm).encode())


@dataclass(frozen=True)
class Timeline(Artifact):
    """Compiled multi-track symbolic output (roadmap §8.2).

    ``tracks`` maps track names to note streams on one shared absolute clock.
    ``micro_offsets`` preserves the pre-quantization onset deviations per track
    (same order as that track's events), making quantization reversible — the
    grid for notation, the offsets for playback realism.
    """

    tracks: tuple[tuple[str, NoteStream], ...]
    tempo_bpm: float = 120.0
    micro_offsets: tuple[tuple[str, tuple[float, ...]], ...] = ()

    def track_names(self) -> list[str]:
        return [name for name, _ in self.tracks]

    def get(self, name: str) -> NoteStream | None:
        for n, s in self.tracks:
            if n == name:
                return s
        return None

    def total_events(self) -> int:
        return sum(len(s.events) for _, s in self.tracks)

    def content_key(self) -> str:
        parts = [f"{self.tempo_bpm:.3f}"]
        for name, stream in self.tracks:
            parts.append(name)
            parts.append(stream.content_key())
        return _hash_bytes("|".join(parts).encode())
