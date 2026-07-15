"""MusicXML export (roadmap §7.3, §9.4) — dependency-free, hand-written.

Produces a minimal but valid MusicXML 3.1 partwise score: one ``<part>`` per
Timeline track, 4/4 measures at the timeline's tempo, quantized to a 16th-note
grid (``divisions=4``). Simultaneous onsets in a track become a chord; a note
that would overlap the next one's onset is shortened to end exactly at it —
this is a single-voice engraving simplification (the "readable layer" of
roadmap §7.3; the untouched MIDI remains the "played layer"). Pitch spelling
uses :func:`neiro.symbolic.spelling.spell_pitch` so key context (F major vs.
D major) picks sharps or flats consistently.

If ``music21`` is importable, :func:`write_musicxml` still uses this
hand-written writer (it is already correct and dependency-free); music21
remains a natural place to hang richer engraving later without changing this
module's public contract.
"""

from __future__ import annotations

import xml.sax.saxutils as sx
from pathlib import Path

from neiro.engine.artifacts import NoteEvent, Timeline
from neiro.symbolic.spelling import key_accidentals

__all__ = ["write_musicxml"]

_DIVISIONS = 4  # ticks per quarter note -> 16th-note grid
_TYPE_BY_TICKS = {16: "whole", 8: "half", 4: "quarter", 2: "eighth", 1: "16th"}
_PC_SHARP = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
_ALTER_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
_PC_FLAT = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"]
_ALTER_FLAT = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0]


def _step_alter_octave(pitch: int, flats: bool) -> tuple[str, int, int]:
    pc = pitch % 12
    octave = pitch // 12 - 1
    if flats:
        return _PC_FLAT[pc], _ALTER_FLAT[pc], octave
    return _PC_SHARP[pc], _ALTER_SHARP[pc], octave


def _duration_type(ticks: int) -> str | None:
    return _TYPE_BY_TICKS.get(ticks)


def _note_xml(
    *,
    step: str,
    alter: int,
    octave: int,
    duration: int,
    voice: int = 1,
    chord: bool = False,
    rest: bool = False,
    confidence: float | None = None,
) -> str:
    parts = ["      <note>"]
    if chord:
        parts.append("        <chord/>")
    if rest:
        parts.append("        <rest/>")
    else:
        parts.append("        <pitch>")
        parts.append(f"          <step>{step}</step>")
        if alter:
            parts.append(f"          <alter>{alter}</alter>")
        parts.append(f"          <octave>{octave}</octave>")
        parts.append("        </pitch>")
    parts.append(f"        <duration>{duration}</duration>")
    parts.append(f"        <voice>{voice}</voice>")
    dtype = _duration_type(duration)
    if dtype:
        parts.append(f"        <type>{dtype}</type>")
    if confidence is not None and confidence < 0.6:
        # Low-confidence notes get a visible notehead cue rather than being
        # silently presented with the same certainty as a verified note
        # (roadmap §7.3 "confidence surfaces through").
        parts.append("        <notehead>x</notehead>")
    parts.append("      </note>")
    return "\n".join(parts)


def _track_to_measures(events: tuple[NoteEvent, ...], bpm: float, ticks_per_measure: int):
    """Bucket note events (in ticks) into fixed-size measures, filling rests."""
    sec_per_tick = 60.0 / bpm / _DIVISIONS
    items = []
    for e in sorted(events, key=lambda ev: (ev.onset, ev.pitch)):
        onset_tick = int(round(e.onset / sec_per_tick))
        dur_tick = max(1, int(round((e.offset - e.onset) / sec_per_tick)))
        items.append((onset_tick, dur_tick, e))

    if not items:
        return [], 0
    last_end = max(t + d for t, d, _ in items)
    n_measures = max(1, -(-last_end // ticks_per_measure))  # ceil div

    # Clip each note so it never overlaps the next distinct onset (single voice).
    onsets = sorted({t for t, _d, _e in items})
    clipped = []
    for t, d, e in items:
        later = [o for o in onsets if o > t]
        if later:
            d = min(d, later[0] - t)
        clipped.append((t, max(1, d), e))

    measures: list[list[tuple[int, int, NoteEvent]]] = [[] for _ in range(n_measures)]
    cursor = 0
    grouped: dict[int, list[tuple[int, NoteEvent]]] = {}
    for t, d, e in clipped:
        grouped.setdefault(t, []).append((d, e))

    for t in sorted(grouped):
        if t > cursor:
            _emit_rests(measures, cursor, t - cursor, ticks_per_measure)
        chord = grouped[t]
        dur = min(d for d, _ in chord)
        m_idx = t // ticks_per_measure
        measures[m_idx].append((t, dur, chord))
        cursor = t + dur
    if cursor < n_measures * ticks_per_measure:
        _emit_rests(measures, cursor, n_measures * ticks_per_measure - cursor, ticks_per_measure)
    return measures, n_measures


def _emit_rests(measures: list[list], start: int, length: int, ticks_per_measure: int) -> None:
    remaining = length
    t = start
    while remaining > 0:
        m_idx = t // ticks_per_measure
        room = ticks_per_measure - (t % ticks_per_measure)
        take = min(remaining, room)
        measures[m_idx].append((t, take, None))
        t += take
        remaining -= take


def write_musicxml(
    timeline: Timeline,
    path: str | Path,
    *,
    key: str | None = None,
    title: str = "Neiro transcription",
) -> Path:
    """Write a Timeline as a minimal, valid MusicXML 3.1 partwise score."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    flats = key_accidentals(key) == "flat"
    ticks_per_measure = 4 * _DIVISIONS  # 4/4

    part_list = ["  <part-list>"]
    parts_xml = []
    for i, (name, stream) in enumerate(timeline.tracks):
        part_id = f"P{i + 1}"
        part_list.append(
            f'    <score-part id="{part_id}"><part-name>{sx.escape(name)}</part-name></score-part>'
        )

        measures, n_measures = _track_to_measures(
            stream.events, timeline.tempo_bpm, ticks_per_measure
        )
        measure_blocks = []
        for m_idx in range(n_measures):
            body = []
            if m_idx == 0:
                body.append("      <attributes>")
                body.append(f"        <divisions>{_DIVISIONS}</divisions>")
                body.append("        <key><fifths>0</fifths></key>")
                body.append("        <time><beats>4</beats><beat-type>4</beat-type></time>")
                body.append("      </attributes>")
            entries = sorted(measures[m_idx], key=lambda x: x[0]) if measures else []
            for _t, dur, chord in entries:
                if chord is None:
                    body.append(_note_xml(step="C", alter=0, octave=4, duration=dur, rest=True))
                    continue
                for j, (_d, e) in enumerate(chord):
                    step, alter, octave = _step_alter_octave(e.pitch, flats)
                    body.append(
                        _note_xml(
                            step=step,
                            alter=alter,
                            octave=octave,
                            duration=dur,
                            chord=j > 0,
                            confidence=e.confidence,
                        )
                    )
            measure_blocks.append(
                f'    <measure number="{m_idx + 1}">\n' + "\n".join(body) + "\n    </measure>"
            )
        if not measure_blocks:
            measure_blocks.append(
                '    <measure number="1">\n'
                "      <attributes>\n"
                f"        <divisions>{_DIVISIONS}</divisions>\n"
                "        <key><fifths>0</fifths></key>\n"
                "        <time><beats>4</beats><beat-type>4</beat-type></time>\n"
                "      </attributes>\n"
                f"      <note><rest/><duration>{ticks_per_measure}</duration></note>\n"
                "    </measure>"
            )
        parts_xml.append(f'  <part id="{part_id}">\n' + "\n".join(measure_blocks) + "\n  </part>")
    part_list.append("  </part-list>")

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
        '<score-partwise version="3.1">\n'
        f"  <work><work-title>{sx.escape(title)}</work-title></work>\n"
        + "\n".join(part_list)
        + "\n"
        + "\n".join(parts_xml)
        + "\n</score-partwise>\n"
    )
    path.write_text(xml, encoding="utf-8")
    return path
