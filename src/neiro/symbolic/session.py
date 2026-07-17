"""Editable transcription session (roadmap §9.4 "editing … marks user-verified").

A thin, framework-agnostic CRUD layer over a :class:`Timeline` so both the
CLI/tests and the HTTP server (:mod:`neiro.ui.server`) share one
implementation of "add/move/delete a note, mark it verified." Edits always
set ``confidence=1.0`` and ``user_verified=True`` — a human confirming a note
is definitionally certain, and the piano roll/notation views use that flag to
stop desaturating it.

Not thread-safe by itself; callers (the HTTP server) hold their own lock.
"""

from __future__ import annotations

from dataclasses import replace

from neiro.engine.artifacts import NoteEvent, NoteStream, Timeline

__all__ = ["TranscriptionSession"]


class TranscriptionSession:
    """Mutable wrapper around a :class:`Timeline` supporting note CRUD."""

    def __init__(self, timeline: Timeline) -> None:
        self.tempo_bpm = timeline.tempo_bpm
        self.micro_offsets = dict(timeline.micro_offsets)
        self._tracks: dict[str, list[NoteEvent]] = {
            name: list(stream.events) for name, stream in timeline.tracks
        }
        self._sources: dict[str, str] = {name: stream.source for name, stream in timeline.tracks}

    def track_names(self) -> list[str]:
        return list(self._tracks)

    def list_notes(self, track: str) -> list[NoteEvent]:
        return list(self._tracks.get(track, []))

    def add_note(self, track: str, note: NoteEvent, *, verified: bool = True) -> int:
        """Insert a note (default: as a user-verified addition). Returns its index."""
        if verified:
            note = replace(note, confidence=1.0, user_verified=True)
        events = self._tracks.setdefault(track, [])
        events.append(note)
        events.sort(key=lambda e: (e.onset, e.pitch))
        return events.index(note)

    def update_note(self, track: str, index: int, **changes) -> NoteEvent:
        """Edit fields of an existing note; always pins it as user-verified."""
        events = self._tracks.get(track)
        if events is None or not (0 <= index < len(events)):
            raise IndexError(f"no note at {track}[{index}]")
        changes.setdefault("confidence", 1.0)
        changes["user_verified"] = True
        updated = replace(events[index], **changes)
        events[index] = updated
        events.sort(key=lambda e: (e.onset, e.pitch))
        return updated

    def delete_note(self, track: str, index: int) -> None:
        events = self._tracks.get(track)
        if events is None or not (0 <= index < len(events)):
            raise IndexError(f"no note at {track}[{index}]")
        del events[index]

    def quantize(
        self,
        *,
        division: int = 4,
        strength: float = 1.0,
        track: str | None = None,
    ) -> None:
        """Snap notes to a beat grid (groove-preserving when strength < 1)."""
        from neiro.symbolic.timeline import quantize_stream

        bpm = float(self.tempo_bpm or 120)
        names = [track] if track else list(self._tracks)
        for name in names:
            events = self._tracks.get(name) or []
            if not events:
                continue
            stream = NoteStream(tuple(events), bpm, self._sources.get(name, ""))
            qstream, offs = quantize_stream(stream, bpm, division=division, strength=strength)
            self._tracks[name] = [
                replace(e, confidence=1.0, user_verified=True) for e in qstream.events
            ]
            self.micro_offsets[name] = offs

    def confidence_summary(self) -> dict[str, dict[str, float | int]]:
        """Per-track note count, mean confidence, and verified-note count."""
        out: dict[str, dict[str, float | int]] = {}
        for track, events in self._tracks.items():
            n = len(events)
            mean_conf = round(sum(e.confidence for e in events) / n, 3) if n else 1.0
            verified = sum(1 for e in events if e.user_verified)
            out[track] = {"count": n, "mean_confidence": mean_conf, "verified": verified}
        return out

    def to_timeline(self) -> Timeline:
        tracks = tuple(
            (name, NoteStream(tuple(events), self.tempo_bpm, self._sources.get(name, "")))
            for name, events in self._tracks.items()
        )
        micro = tuple(self.micro_offsets.items())
        return Timeline(tracks, tempo_bpm=self.tempo_bpm, micro_offsets=micro)
