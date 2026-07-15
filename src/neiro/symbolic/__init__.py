"""Symbolic layer: routing, orchestration, timeline compilation, and export."""

from neiro.symbolic.lyrics import write_lrc
from neiro.symbolic.midi import read_midi_notes, write_midi
from neiro.symbolic.musicxml import write_musicxml
from neiro.symbolic.notestream_json import notestream_from_json, notestream_to_json
from neiro.symbolic.score import export_score
from neiro.symbolic.spelling import spell_pitch
from neiro.symbolic.tablature import write_tablature
from neiro.symbolic.timeline import compile_timeline, merge_streams, quantize_stream

__all__ = [
    "compile_timeline",
    "quantize_stream",
    "merge_streams",
    "write_midi",
    "read_midi_notes",
    "write_musicxml",
    "write_tablature",
    "write_lrc",
    "export_score",
    "spell_pitch",
    "notestream_to_json",
    "notestream_from_json",
]
