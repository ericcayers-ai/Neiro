"""Enharmonic pitch spelling from key context (roadmap §7.3).

MIDI pitch numbers are enharmonically ambiguous (61 is both C#4 and Db4).
Notation needs a specific spelling, and the right choice depends on key: a
piece in F major spells that pitch class Db, one in D major spells it C#.
This is a compact, dependency-free spelling table driven by the circle of
fifths — good enough for the common tonal cases the analysis pass's
Krumhansl-Schmuckler key estimate returns (``"F major"``, ``"C# minor"``, …).
"""

from __future__ import annotations

__all__ = ["spell_pitch", "key_accidentals"]

_SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Circle-of-fifths order of major key tonics (pitch class), sharp side first.
_SHARP_KEYS = {"C", "G", "D", "A", "E", "B", "F#", "C#"}
_FLAT_KEYS = {"C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"}

_NAME_TO_PC = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "F": 5,
    "E#": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

# Relative-minor tonics that prefer flats (their relative major is flat-side).
_MINOR_FLAT_TONICS = {"D", "G", "C", "F", "Bb", "Eb", "Ab"}


def key_accidentals(key: str | None) -> str:
    """Return ``"sharp"`` or ``"flat"`` — the spelling preference for a key string.

    ``key`` is the analysis pass's format, e.g. ``"F major"`` / ``"C# minor"``.
    Defaults to sharp (the more common notational default, and correct for C
    major/A minor) when the key is unknown or unparseable.
    """
    if not key:
        return "sharp"
    parts = key.strip().split()
    if not parts:
        return "sharp"
    tonic = parts[0]
    mode = parts[1].lower() if len(parts) > 1 else "major"
    if mode.startswith("min"):
        return "flat" if tonic in _MINOR_FLAT_TONICS else "sharp"
    if tonic in _FLAT_KEYS and tonic not in _SHARP_KEYS:
        return "flat"
    return "sharp"


def spell_pitch(midi_pitch: int, key: str | None = None) -> str:
    """Spell a MIDI pitch number as a note name (e.g. ``"F#4"``) given a key context."""
    pc = midi_pitch % 12
    octave = midi_pitch // 12 - 1  # MIDI octave convention: C4 = 60
    names = _FLAT_NAMES if key_accidentals(key) == "flat" else _SHARP_NAMES
    return f"{names[pc]}{octave}"
