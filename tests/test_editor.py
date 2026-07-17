"""Tests for the audio-editor DSP and visualization data."""

import numpy as np

from neiro.dsp import edit as ed
from neiro.dsp import spectrogram_image, waveform_peaks
from neiro.engine.artifacts import AudioTensor

SR = 44100


def _audio(seconds=2.0, freq=220.0, amp=0.5, channels=2):
    t = np.arange(int(seconds * SR)) / SR
    x = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    data = np.stack([x] * channels) if channels > 1 else x[np.newaxis, :]
    return AudioTensor(data, SR)


# ---- edit operations --------------------------------------------------------


def test_trim_keeps_region():
    a = _audio(2.0)
    out = ed.trim(a, 0.5, 1.5)
    assert abs(out.duration_seconds - 1.0) < 1e-3
    assert out.channels == 2


def test_delete_region_shortens():
    a = _audio(2.0)
    out = ed.delete_region(a, 0.5, 1.0)
    assert abs(out.duration_seconds - 1.5) < 1e-3


def test_silence_region_zeros_but_keeps_length():
    a = _audio(2.0)
    out = ed.silence_region(a, 0.5, 1.5)
    assert out.frames == a.frames
    s, e = int(0.6 * SR), int(1.4 * SR)
    assert np.max(np.abs(out.samples[:, s:e])) == 0.0
    # Outside the region, audio is untouched.
    assert np.max(np.abs(out.samples[:, : int(0.4 * SR)])) > 0.1


def test_gain_whole_and_region():
    a = _audio(1.0, amp=0.5)
    whole = ed.gain(a, 6.0)
    assert abs(whole.peak() / a.peak() - 2.0) < 0.02
    region = ed.gain(a, -6.0, 0.2, 0.8)
    # Region attenuated; edges intact.
    assert region.samples[:, int(0.5 * SR)].max() < a.samples[:, int(0.5 * SR)].max()


def test_fade_in_starts_silent():
    a = _audio(1.0)
    out = ed.fade(a, 0.0, 0.5, direction="in")
    assert abs(float(out.samples[0, 0])) < 1e-6
    assert np.max(np.abs(out.samples[:, : int(0.5 * SR)])) < a.peak()


def test_reverse_is_involution():
    a = _audio(0.5)
    twice = ed.reverse(ed.reverse(a))
    assert np.allclose(twice.samples, a.samples)


def test_normalize_hits_target():
    a = _audio(1.0, amp=0.1)
    out = ed.normalize(a, -1.0)
    assert abs(20 * np.log10(out.peak()) - (-1.0)) < 0.1


def test_edit_is_nondestructive():
    a = _audio(1.0)
    before = a.samples.copy()
    ed.silence_region(a, 0.0, 0.5)
    ed.gain(a, 6.0)
    assert np.array_equal(a.samples, before)  # original untouched


def test_out_of_range_selection_is_clamped():
    a = _audio(1.0)
    out = ed.trim(a, -5.0, 100.0)  # clamps to full signal
    assert out.frames == a.frames


def test_split_at_partitions_duration():
    a = _audio(2.0)
    left, right = ed.split_at(a, 0.75)
    assert abs(left.duration_seconds - 0.75) < 1e-3
    assert abs(right.duration_seconds - 1.25) < 1e-3


def test_bounce_sums_layers_with_offset_and_gain():
    a = _audio(1.0, amp=0.4)
    b = _audio(1.0, amp=0.4)
    out = ed.bounce([(a, 1.0, 0.0, 0.0), (b, 0.5, 0.0, 0.5)])
    assert abs(out.duration_seconds - 1.5) < 1e-2
    assert out.channels == 2
    # Offset extends the timeline; overlap region still carries audible energy.
    s, e = int(0.55 * SR), int(0.95 * SR)
    assert float(np.max(np.abs(out.samples[:, s:e]))) > 0.2
    # Tail after the first layer ends still has the delayed second layer.
    tail = int(1.25 * SR)
    assert float(np.max(np.abs(out.samples[:, tail : tail + 200]))) > 0.05


def test_bounce_empty_is_short_silence():
    out = ed.bounce([])
    assert out.frames > 0
    assert float(np.max(np.abs(out.samples))) == 0.0


# ---- visualization ----------------------------------------------------------


def test_waveform_peaks_shape_and_range():
    a = _audio(2.0)
    wf = waveform_peaks(a, width=500)
    assert wf["width"] == 500
    assert len(wf["min"]) == 500 and len(wf["max"]) == 500
    assert all(mn <= mx for mn, mx in zip(wf["min"], wf["max"], strict=True))
    assert max(wf["max"]) <= 1.0 and min(wf["min"]) >= -1.0


def test_waveform_width_capped_to_frames():
    a = AudioTensor(np.zeros((1, 100), dtype=np.float32), SR)
    wf = waveform_peaks(a, width=1000)
    assert wf["width"] <= 100


def test_spectrogram_dimensions_and_bytes():
    a = _audio(2.0, freq=1000.0)
    spec = spectrogram_image(a, max_frames=200, freq_bins=128)
    assert spec["rows"] == 128
    assert spec["cols"] <= 200
    assert len(spec["data"]) == spec["rows"] * spec["cols"]
    assert all(0 <= v <= 255 for v in spec["data"][:50])


def test_spectrogram_time_range():
    a = _audio(2.0, freq=1000.0)
    full = spectrogram_image(a, max_frames=200, freq_bins=128)
    window = spectrogram_image(a, max_frames=200, freq_bins=128, start=0.25, end=0.75)
    assert window["rows"] == 128
    assert 0 < window["cols"] < full["cols"]
    assert len(window["data"]) == window["rows"] * window["cols"]
    assert abs(window["duration"] - 2.0) < 0.01


def test_spectrogram_locates_tone_frequency():
    # A 1 kHz tone should light up near its log-frequency row, not at the extremes.
    a = _audio(2.0, freq=1000.0)
    spec = spectrogram_image(a, max_frames=200, freq_bins=128)
    grid = np.array(spec["data"], dtype=np.uint8).reshape(spec["rows"], spec["cols"])
    row_energy = grid.mean(axis=1)
    peak_row = int(np.argmax(row_energy))  # row 0 = highest freq (fmax)
    # Expected row for 1 kHz on the log axis (top-down).
    frac = np.log10(1000.0 / spec["fmin"]) / np.log10(spec["fmax"] / spec["fmin"])
    expected_row = int((1 - frac) * spec["rows"])
    assert abs(peak_row - expected_row) < 12


# ---- time stretch / pitch -----------------------------------------------


def test_time_stretch_lengthens():
    a = _audio(1.0)
    out = ed.time_stretch(a, 1.5)
    assert abs(out.duration_seconds - 1.5) < 0.15
    assert out.sample_rate == a.sample_rate


def test_time_stretch_identity():
    a = _audio(0.5)
    out = ed.time_stretch(a, 1.0)
    assert out.frames == a.frames


def test_pitch_shift_keeps_duration():
    a = _audio(0.8)
    out = ed.pitch_shift(a, 2.0)
    assert abs(out.duration_seconds - a.duration_seconds) < 0.05


def test_pitch_correct_keeps_duration_and_channels():
    # Slightly sharp 220 Hz tone (~A3) — should stay same length.
    a = _audio(1.2, freq=226.0, channels=1)
    out = ed.pitch_correct(a, strength=1.0)
    assert out.channels == 1
    assert abs(out.duration_seconds - a.duration_seconds) < 0.08
    prov = out.provenance
    text = " ".join(prov) if isinstance(prov, (tuple, list)) else str(prov)
    assert "pitch_correct" in text


def test_pitch_correct_strength_zero_is_noop():
    a = _audio(0.6, freq=230.0)
    out = ed.pitch_correct(a, strength=0.0)
    assert np.allclose(out.samples, a.samples)


def test_parse_key_scale_major_minor():
    assert ed._parse_key_scale("C") == [0, 2, 4, 5, 7, 9, 11]
    assert 9 in ed._parse_key_scale("Am")  # A
    assert ed._parse_key_scale("") is None
