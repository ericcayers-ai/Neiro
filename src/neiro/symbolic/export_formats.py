"""MusicXML and ASCII tablature exports (roadmap §7.4)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _midi_to_step_alter_octave(midi: int) -> tuple[str, int, int]:
    pc = midi % 12
    octave = midi // 12 - 1
    name = _PITCH_NAMES[pc]
    if len(name) == 2 and name[1] == "#":
        return name[0], 1, octave
    return name, 0, octave


def _iter_tracks(timeline: Any) -> dict[str, list[Any]]:
    if hasattr(timeline, "tracks") and timeline.tracks:
        # Timeline stores tuple[tuple[str, NoteStream], ...]
        out: dict[str, list[Any]] = {}
        for item in timeline.tracks:
            if isinstance(item, tuple) and len(item) == 2:
                name, stream = item
                events = list(getattr(stream, "events", stream))
                out[str(name)] = events
            elif isinstance(item, str):
                continue
        if out:
            return out
    if isinstance(timeline, dict) and "tracks" in timeline:
        raw = timeline["tracks"]
        if isinstance(raw, dict):
            return {k: list(getattr(v, "events", v)) for k, v in raw.items()}
    if hasattr(timeline, "events"):
        return {"melody": list(timeline.events)}
    return {"melody": []}


def write_musicxml(timeline: Any, path: str | Path) -> Path:
    """Write a minimal but valid MusicXML 3.1 score-partwise document."""
    path = Path(path)
    score = ET.Element("score-partwise", version="3.1")
    part_list = ET.SubElement(score, "part-list")

    tracks = _iter_tracks(timeline)
    for i, name in enumerate(tracks, start=1):
        sp = ET.SubElement(part_list, "score-part", id=f"P{i}")
        ET.SubElement(sp, "part-name").text = str(name)

    tempo = float(getattr(timeline, "tempo_bpm", None) or 120.0)
    divisions = 4

    for i, (_name, events) in enumerate(tracks.items(), start=1):
        part = ET.SubElement(score, "part", id=f"P{i}")
        measure = ET.SubElement(part, "measure", number="1")
        attrs = ET.SubElement(measure, "attributes")
        ET.SubElement(attrs, "divisions").text = str(divisions)
        time_el = ET.SubElement(attrs, "time")
        ET.SubElement(time_el, "beats").text = "4"
        ET.SubElement(time_el, "beat-type").text = "4"

        beat_dur = 60.0 / tempo
        cursor = 0.0
        for ev in events:
            onset = float(getattr(ev, "onset", ev["onset"] if isinstance(ev, dict) else 0))
            offset = float(
                getattr(ev, "offset", ev["offset"] if isinstance(ev, dict) else onset + 0.25)
            )
            pitch = int(getattr(ev, "pitch", ev["pitch"] if isinstance(ev, dict) else 60))
            if onset > cursor + 1e-3:
                rest_beats = (onset - cursor) / beat_dur
                dur = max(1, int(round(rest_beats * divisions)))
                note = ET.SubElement(measure, "note")
                ET.SubElement(note, "rest")
                ET.SubElement(note, "duration").text = str(dur)
                cursor = onset
            note_beats = max(0.25, (offset - onset) / beat_dur)
            dur = max(1, int(round(note_beats * divisions)))
            note = ET.SubElement(measure, "note")
            pitch_el = ET.SubElement(note, "pitch")
            step, alter, octave = _midi_to_step_alter_octave(pitch)
            ET.SubElement(pitch_el, "step").text = step
            if alter:
                ET.SubElement(pitch_el, "alter").text = str(alter)
            ET.SubElement(pitch_el, "octave").text = str(octave)
            ET.SubElement(note, "duration").text = str(dur)
            cursor = max(cursor, offset)

    tree = ET.ElementTree(score)
    ET.indent(tree, space="  ")
    path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return path


def write_ascii_tab(events: list[Any], path: str | Path, *, string_count: int = 6) -> Path:
    """Naive MIDI→tab assignment (lowest playable fret preference)."""
    path = Path(path)
    opens = [64, 59, 55, 50, 45, 40][:string_count]
    labels = ["e", "B", "G", "D", "A", "E"][:string_count]
    buf = ["" for _ in range(string_count)]
    for ev in events:
        pitch = int(getattr(ev, "pitch", ev["pitch"] if isinstance(ev, dict) else 60))
        best = None
        for s, open_p in enumerate(opens):
            fret = pitch - open_p
            if 0 <= fret <= 24:
                best = (s, fret)
                break
        for s in range(string_count):
            if best and s == best[0]:
                buf[s] += f"{best[1]}-"
            else:
                buf[s] += "--"
    text = "\n".join(f"{labels[i]}|{buf[i]}|" for i in range(string_count)) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def write_lrc(lines: list[tuple[float, str]], path: str | Path) -> Path:
    path = Path(path)
    out = []
    for t, text in lines:
        m = int(t // 60)
        s = t % 60
        out.append(f"[{m:02d}:{s:05.2f}]{text}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return path
