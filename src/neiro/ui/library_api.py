"""HTTP surface for the local library. Called from the main handler."""

from __future__ import annotations

import base64
import binascii
import hashlib
import struct
from pathlib import Path
from typing import Any

from neiro.library.store import LibraryStore

# A Standard MIDI File is tiny (a 10-minute piano piece is well under 100 kB). The cap
# exists so a wrong file picked in the dialog cannot be base64'd into the JSON body.
MIDI_IMPORT_LIMIT_BYTES = 4 * 1024 * 1024
MIDI_SUFFIXES = (".mid", ".midi")


def _store() -> LibraryStore:
    return LibraryStore()


def _import_midi_target(store: LibraryStore, state: Any, body: dict) -> tuple[int, dict]:
    """Store a user's ``.mid`` as a practice target (PianoVision adoption leg F).

    Bytes arrive base64-encoded in the JSON body rather than as a multipart upload: the
    library POST route already speaks JSON (``POST /api/library/...`` reads ``_read_json``),
    and the existing ``/api/upload`` decodes audio, so a ``.mid`` there is a 422.

    The response carries the parsed target only. The practice descriptor (difficulty,
    notes/second, channels) is derived by the frontend from these notes, so there is one
    implementation of that arithmetic rather than two that can disagree.
    """
    name = str(body.get("name") or "target.mid")
    # A dialogs-supplied name is a name, never a path: collapsing to the basename keeps
    # the write inside the workspace.
    name = Path(name.replace("\\", "/")).name
    if Path(name).suffix.lower() not in MIDI_SUFFIXES:
        return 400, {"error": "a MIDI target must be a .mid or .midi file"}
    encoded = body.get("midi_base64")
    if not isinstance(encoded, str) or not encoded:
        return 400, {"error": "midi_base64 is required (the .mid bytes, base64-encoded)"}
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return 400, {"error": "midi_base64 is not valid base64"}
    if not data:
        return 400, {"error": "empty upload"}
    if len(data) > MIDI_IMPORT_LIMIT_BYTES:
        return 400, {"error": f"MIDI file too large (max {MIDI_IMPORT_LIMIT_BYTES} bytes)"}

    from neiro.symbolic.midi import read_midi_notes

    workspace = getattr(state, "workspace", None)
    # Content-addressed directory: re-importing the same file lands on the same path, so the
    # store's path key updates one row instead of stacking a duplicate per click.
    digest = hashlib.sha256(data).hexdigest()[:16]
    target_dir = Path(workspace or ".") / "midi" / digest
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / name
    dest.write_bytes(data)
    try:
        stream = read_midi_notes(dest)
    except (ValueError, struct.error, IndexError) as exc:
        # The bytes are not a readable SMF: nothing is registered, and the message names
        # the reason rather than a stack trace.
        return 400, {"error": f"couldn't read the MIDI file: {exc}"}
    if not stream.events:
        return 400, {"error": "this file carries no notes"}

    tracks: dict[str, list[dict[str, Any]]] = {}
    for event in stream.events:
        tracks.setdefault(event.track, []).append(
            {
                "onset": event.onset,
                "offset": event.offset,
                "pitch": event.pitch,
                "velocity": event.velocity,
                "confidence": event.confidence,
            }
        )
    target = store.upsert_midi_target(
        title=str(body.get("title") or Path(name).stem),
        path=str(dest),
        tempo_bpm=stream.tempo_bpm,
        tracks=tracks,
    )
    return 200, {"ok": True, "target": target}


def _duration_of(path: Path) -> float | None:
    try:
        import soundfile as sf

        return float(sf.info(str(path)).duration)
    except Exception:
        return None


def handle_library(
    state: Any, method: str, path: str, body: dict | None = None
) -> tuple[int, dict]:
    """Dispatch ``/api/library/...`` and return ``(status, payload)``."""
    store = _store()
    parts = [part for part in path.strip("/").split("/") if part]
    # api / library / <resource> / ...
    resource = parts[2] if len(parts) > 2 else ""
    rest = parts[3:]
    body = body or {}

    try:
        if resource == "songs" and not rest:
            if method == "GET":
                return 200, {"songs": store.list_songs()}
            if method == "POST":
                file_id = str(body.get("file_id") or "")
                path_value = None
                if file_id:
                    if file_id not in state.files:
                        return 400, {"error": f"unknown file_id {file_id!r}"}
                    path_value = str(state.files[file_id])
                title = str(
                    body.get("title") or (Path(path_value).name if path_value else "Untitled")
                )
                song = store.upsert_song(
                    title=title,
                    artist=body.get("artist"),
                    source_url=body.get("source_url"),
                    path=path_value,
                    duration=body.get("duration")
                    or (_duration_of(Path(path_value)) if path_value else None),
                    fingerprint=body.get("fingerprint"),
                    notes=body.get("notes"),
                    settings=body.get("settings"),
                )
                return 200, {"ok": True, "song": song}

        if resource == "songs" and rest:
            song_id = rest[0]
            if len(rest) == 1:
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"song": song}
                if method == "DELETE":
                    return 200, {"ok": store.delete_song(song_id)}
            if len(rest) == 2 and rest[1] == "notes" and method == "POST":
                return 200, store.set_notes(song_id, str(body.get("notes") or ""))
            if len(rest) == 2 and rest[1] == "markers":
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"markers": song["markers"]}
                if method == "POST":
                    marker = store.add_marker(
                        song_id,
                        float(body.get("time") or 0.0),
                        str(body.get("label") or ""),
                        body.get("color"),
                    )
                    return 200, {"ok": True, "marker": marker}
            if len(rest) == 2 and rest[1] == "clips":
                if method == "GET":
                    song = store.get_song(song_id)
                    if song is None:
                        return 404, {"error": "song not found"}
                    return 200, {"clips": song["clips"]}
                if method == "POST":
                    clip = store.add_clip(
                        song_id,
                        name=str(body.get("name") or "Clip"),
                        start=float(body.get("start") or 0.0),
                        end=float(body.get("end") or 0.0),
                        loop_count=int(body.get("loop_count") or 1),
                        enabled=bool(body.get("enabled", True)),
                        settings=body.get("settings"),
                    )
                    return 200, {"ok": True, "clip": clip}
            if len(rest) == 2 and rest[1] == "settings" and method == "POST":
                settings = body.get("settings")
                if not isinstance(settings, dict):
                    return 400, {"error": "settings must be an object"}
                return 200, store.set_settings(song_id, settings)
            if len(rest) == 2 and rest[1] == "played" and method == "POST":
                store.touch_song(song_id)
                return 200, {"ok": True, "song_id": song_id}
            if len(rest) == 2 and rest[1] == "versions" and method == "POST":
                version = store.add_version(
                    song_id,
                    label=str(body.get("label") or "version"),
                    session_path=body.get("session_path"),
                    settings=body.get("settings"),
                )
                return 200, {"ok": True, "version": version}

        if resource == "markers" and rest and method == "DELETE":
            return 200, {"ok": store.delete_marker(rest[0])}
        if resource == "clips" and rest and method == "DELETE":
            return 200, {"ok": store.delete_clip(rest[0])}
        if resource == "scenes":
            if method == "GET" and not rest:
                return 200, {"scenes": store.list_scenes()}
            if method == "POST" and not rest:
                scene = store.add_scene(
                    name=str(body.get("name") or "Scene"),
                    kind=str(body.get("kind") or "standard"),
                    song_id=body.get("song_id"),
                    layout=body.get("layout"),
                )
                return 200, {"ok": True, "scene": scene}
            if method == "DELETE" and rest:
                return 200, {"ok": store.delete_scene(rest[0])}
        if resource == "playlists":
            if method == "GET" and not rest:
                return 200, {"playlists": store.list_playlists()}
            if method == "POST" and not rest:
                return 200, {
                    "ok": True,
                    "playlist": store.create_playlist(str(body.get("name") or "Playlist")),
                }
            if method == "POST" and len(rest) == 2 and rest[1] == "items":
                return 200, store.add_to_playlist(rest[0], str(body.get("song_id") or ""))
        if resource == "reset" and method == "POST":
            if body.get("confirm") is not True:
                return 400, {"error": "library reset requires {'confirm': true}"}
            return 200, {"ok": True, "removed_songs": store.reset(confirm=True)}
        if resource == "midi-targets":
            if method == "GET" and not rest:
                return 200, {"targets": store.list_midi_targets()}
            if method == "GET" and rest:
                target = store.get_midi_target(rest[0])
                if target is None:
                    return 404, {"error": "midi target not found"}
                return 200, {"target": target}
            if method == "DELETE" and rest:
                return 200, {"ok": store.delete_midi_target(rest[0])}
            if method == "POST" and not rest:
                return _import_midi_target(store, state, body)

        if resource == "export" and method == "GET":
            return 200, {
                "version": 1,
                "exported_at": __import__("time").time(),
                "songs": store.list_songs(),
                "playlists": store.list_playlists(),
            }
    except KeyError as exc:
        return 404, {"error": str(exc).strip("'\"")}
    except ValueError as exc:
        return 400, {"error": str(exc)}

    return 404, {"error": "unknown library route"}
