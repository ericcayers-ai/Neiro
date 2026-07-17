"""Tests for Wave 5 session graph_config helpers (frontend mirror in Python N/A).

Covers pitch_correct key parsing edge cases already in test_editor; this file
adds fit-view semantics used by Studio fitter zoom.
"""

from neiro.dsp import edit as ed


def test_snap_midi_chromatic():
    assert ed._snap_midi(60.4, None) == 60.0
    assert ed._snap_midi(60.6, None) == 61.0


def test_snap_midi_to_c_major():
    scale = ed._parse_key_scale("C")
    assert scale is not None
    # 61 is C# — snap toward C (60) or D (62); nearest is either.
    snapped = ed._snap_midi(61.0, scale)
    assert snapped in (60.0, 62.0)
