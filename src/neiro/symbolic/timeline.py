"""Temporal timeline compiler (roadmap §8.2).

Merges parallel NoteStreams onto one absolute clock, deduplicates cross-stream
detections, and applies groove-preserving quantization: notes snap to the grid
for notation while their micro-timing offsets are retained alongside, so the
operation is reversible.
"""

from __future__ import annotations

from dataclasses import replace

from neiro.engine.artifacts import NoteEvent, NoteStream, Timeline

__all__ = ["quantize_stream", "merge_streams", "compile_timeline"]


def quantize_stream(
    stream: NoteStream,
    bpm: float,
    *,
    division: int = 4,
    strength: float = 1.0,
) -> tuple[NoteStream, tuple[float, ...]]:
    """Snap onsets/offsets to a grid of ``division`` cells per beat.

    Returns ``(quantized stream, micro-offsets)`` where each offset is the
    original onset minus the quantized onset — adding them back reproduces the
    performance exactly. ``strength`` blends between free (0) and hard grid (1).
    """
    if bpm <= 0:
        raise ValueError("bpm must be positive")
    cell = 60.0 / bpm / division
    events: list[NoteEvent] = []
    offsets: list[float] = []
    for e in stream.events:
        q_on = round(e.onset / cell) * cell
        new_on = e.onset + strength * (q_on - e.onset)
        duration = e.offset - e.onset
        q_dur = max(cell, round(duration / cell) * cell)
        new_dur = duration + strength * (q_dur - duration)
        offsets.append(round(e.onset - new_on, 6))
        events.append(replace(e, onset=round(new_on, 6), offset=round(new_on + new_dur, 6)))
    return NoteStream(tuple(events), tempo_bpm=bpm, source=stream.source), tuple(offsets)


def merge_streams(
    streams: list[NoteStream],
    *,
    onset_tolerance: float = 0.03,
) -> NoteStream:
    """Merge streams, dropping duplicate detections of the same note.

    Two events are duplicates when they share a pitch and their onsets fall
    within ``onset_tolerance``. The higher-confidence event wins — this is the
    cross-stream reconciliation step for stems that bleed into each other.
    """
    all_events = sorted((e for s in streams for e in s.events), key=lambda e: (e.pitch, e.onset))
    kept: list[NoteEvent] = []
    for e in all_events:
        if kept and kept[-1].pitch == e.pitch and abs(kept[-1].onset - e.onset) <= onset_tolerance:
            if e.confidence > kept[-1].confidence:
                kept[-1] = e
            continue
        kept.append(e)
    kept.sort(key=lambda e: (e.onset, e.pitch))
    sources = ",".join(sorted({s.source for s in streams if s.source}))
    return NoteStream(tuple(kept), source=f"merge({sources})")


def compile_timeline(
    named_streams: dict[str, NoteStream],
    *,
    bpm: float | None = None,
    quantize: bool = True,
    division: int = 4,
    strength: float = 1.0,
) -> Timeline:
    """Assemble named streams into a Timeline on one clock.

    If ``bpm`` is None it falls back to any stream's tempo, then 120. With
    ``quantize`` enabled each track is grid-snapped and its micro-offsets stored.
    """
    if bpm is None:
        bpm = next((s.tempo_bpm for s in named_streams.values() if s.tempo_bpm), 120.0)

    tracks: list[tuple[str, NoteStream]] = []
    micro: list[tuple[str, tuple[float, ...]]] = []
    for name, stream in named_streams.items():
        if quantize:
            q, offs = quantize_stream(stream, bpm, division=division, strength=strength)
            tracks.append((name, q))
            micro.append((name, offs))
        else:
            tracks.append((name, stream))
    return Timeline(tuple(tracks), tempo_bpm=float(bpm), micro_offsets=tuple(micro))
