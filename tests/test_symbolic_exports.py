"""Tests for decoder router and symbolic export formats."""

from pathlib import Path

from neiro.engine.artifacts import LyricEvent, LyricStream, NoteEvent, NoteStream, Timeline
from neiro.symbolic.lyrics import write_lrc
from neiro.symbolic.musicxml import write_musicxml
from neiro.symbolic.router import decoders_for
from neiro.symbolic.tablature import write_tablature
from neiro.symbolic.timeline import quantize_stream


def test_router_piano_prefers_specialist():
    prefs = decoders_for("piano")
    # Roadmap §7.1: Transkun primary, Kong/ByteDance piano as fallback.
    assert prefs[0] == "transkun-piano"
    assert "piano-transcription" in prefs
    assert "timbre-amt" in decoders_for("guitar")
    assert "dsp-yin" in decoders_for("guitar")


def test_quantize_reversible():
    events = (
        NoteEvent(onset=0.11, offset=0.4, pitch=60, velocity=80, confidence=0.9),
        NoteEvent(onset=0.52, offset=0.8, pitch=64, velocity=70, confidence=0.8),
    )
    stream = NoteStream(events, tempo_bpm=120)
    quantized, offsets = quantize_stream(stream, 120, division=4, strength=1.0)
    restored_onsets = [e.onset + o for e, o in zip(quantized.events, offsets, strict=False)]
    for orig, restored in zip(events, restored_onsets, strict=False):
        assert abs(orig.onset - restored) < 1e-6


def test_musicxml_and_tab(tmp_path: Path):
    events = (
        NoteEvent(onset=0.0, offset=0.5, pitch=60, velocity=80, confidence=1.0),
        NoteEvent(onset=0.5, offset=1.0, pitch=64, velocity=70, confidence=0.9),
    )
    stream = NoteStream(events, tempo_bpm=120)
    tl = Timeline(tracks=(("melody", stream),), tempo_bpm=120)
    xml_path = write_musicxml(tl, tmp_path / "out.musicxml")
    text = xml_path.read_text(encoding="utf-8")
    assert "score-partwise" in text
    tab = write_tablature(stream, tmp_path / "out.tab")
    assert tab.is_file() and tab.stat().st_size > 0
    lyrics = LyricStream(
        events=(
            LyricEvent(start=0.0, end=1.0, text="hello"),
            LyricEvent(start=1.5, end=2.0, text="world"),
        )
    )
    lrc = write_lrc(lyrics, tmp_path / "out.lrc")
    body = lrc.read_text(encoding="utf-8")
    assert "hello" in body
