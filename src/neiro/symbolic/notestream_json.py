"""Simple JSON NoteStream format (roadmap §9.4 editable transcription).

A flat, human-readable interchange format for note events — what the editor
UI reads/writes and what :mod:`neiro.symbolic.session` CRUD operates on.
Deliberately not MIDI or MusicXML: those are *export* formats with lossy
rhythmic/notational baggage; this is the lossless working representation.

Shape::

    [
      {"onset": 0.0, "offset": 0.5, "pitch": 60, "velocity": 90,
       "confidence": 1.0, "track": "piano", "provenance": "piano-transcription",
       "user_verified": false},
      ...
    ]
"""

from __future__ import annotations

from typing import Any

from neiro.engine.artifacts import NoteEvent, NoteStream

__all__ = ["note_to_json", "note_from_json", "notestream_to_json", "notestream_from_json"]


def note_to_json(e: NoteEvent) -> dict[str, Any]:
    return {
        "onset": e.onset,
        "offset": e.offset,
        "pitch": e.pitch,
        "velocity": e.velocity,
        "confidence": e.confidence,
        "track": e.track,
        "provenance": e.provenance,
        "user_verified": e.user_verified,
    }


def note_from_json(d: dict[str, Any]) -> NoteEvent:
    return NoteEvent(
        onset=float(d["onset"]),
        offset=float(d["offset"]),
        pitch=int(d["pitch"]),
        velocity=int(d.get("velocity", 80)),
        confidence=float(d.get("confidence", 1.0)),
        track=str(d.get("track", "default")),
        provenance=str(d.get("provenance", "")),
        user_verified=bool(d.get("user_verified", False)),
    )


def notestream_to_json(stream: NoteStream) -> list[dict[str, Any]]:
    return [note_to_json(e) for e in stream.events]


def notestream_from_json(
    data: list[dict[str, Any]], *, tempo_bpm: float | None = None, source: str = ""
) -> NoteStream:
    events = tuple(note_from_json(d) for d in data)
    return NoteStream(tuple(sorted(events, key=lambda e: (e.onset, e.pitch))), tempo_bpm, source)
