"""Tests for TranscriptionSession note edit + quantize (Wave 3 MIDI Studio)."""

from __future__ import annotations

from neiro.engine.artifacts import NoteEvent, NoteStream, Timeline
from neiro.symbolic.session import TranscriptionSession


def _session_with_notes() -> TranscriptionSession:
    events = (
        NoteEvent(onset=0.11, offset=0.4, pitch=60, velocity=90, confidence=0.8),
        NoteEvent(onset=0.52, offset=0.9, pitch=64, velocity=80, confidence=0.7),
    )
    tl = Timeline(
        tracks=(("melody", NoteStream(events, 120.0, "test")),),
        tempo_bpm=120.0,
    )
    return TranscriptionSession(tl)


def test_quantize_snaps_onsets_to_grid():
    sess = _session_with_notes()
    sess.quantize(division=4, strength=1.0)
    notes = sess.list_notes("melody")
    # 120 BPM, division 4 → 16th = 0.125 s
    assert abs(notes[0].onset - 0.125) < 1e-6 or abs(notes[0].onset) < 1e-6
    assert all(n.user_verified for n in notes)


def test_quantize_soft_preserves_nearby_timing():
    sess = _session_with_notes()
    before = sess.list_notes("melody")[0].onset
    sess.quantize(division=4, strength=0.0)
    after = sess.list_notes("melody")[0].onset
    assert abs(after - before) < 1e-9


def test_add_update_delete_roundtrip():
    sess = _session_with_notes()
    idx = sess.add_note(
        "melody",
        NoteEvent(onset=1.0, offset=1.2, pitch=67, velocity=100, confidence=0.5),
    )
    assert idx >= 0
    sess.update_note("melody", idx, velocity=110)
    notes = sess.list_notes("melody")
    updated = next(n for n in notes if n.pitch == 67)
    assert updated.velocity == 110
    assert updated.user_verified
    # delete by finding index after sort
    notes = sess.list_notes("melody")
    i = next(i for i, n in enumerate(notes) if n.pitch == 67)
    sess.delete_note("melody", i)
    assert all(n.pitch != 67 for n in sess.list_notes("melody"))
