"""Analysis honesty: a chord timeline, a beat grid, confidence and no-result.

C13 gate. These tests use synthetic material, so they prove the contract (labels,
confidence bounds, no-result state), not musical accuracy on real recordings.
"""

from __future__ import annotations

import numpy as np

from neiro.analysis import analyze
from neiro.engine.artifacts import AudioTensor


def _tone(freqs: tuple[float, ...], seconds: float = 6.0, sr: int = 22050) -> AudioTensor:
    t = np.arange(int(seconds * sr)) / sr
    signal = np.zeros_like(t)
    for freq in freqs:
        signal += 0.16 * np.sin(2 * np.pi * freq * t)
    return AudioTensor(signal[np.newaxis, :].astype(np.float32), sr)


def _with_clicks(audio: AudioTensor, bpm: float = 120.0) -> AudioTensor:
    samples = audio.samples.copy()
    sr = audio.sample_rate
    period = 60.0 / bpm
    click_len = int(0.01 * sr)
    t = np.arange(click_len) / sr
    click = (0.5 * np.sin(2 * np.pi * 2000 * t) * np.exp(-t * 300)).astype(np.float32)
    time = 0.0
    while time < audio.duration_seconds - 0.05:
        start = int(time * sr)
        end = min(samples.shape[1], start + click_len)
        samples[0, start:end] += click[: end - start]
        time += period
    return AudioTensor(samples, sr)


def test_chord_timeline_and_beat_grid_on_a_c_major_probe():
    report = analyze(_with_clicks(_tone((261.63, 329.63, 392.0))))
    data = report.as_dict()
    assert data["chords"], "expected a chord timeline"
    labels = {segment["chord"] for segment in data["chords"]}
    assert "C" in labels, labels
    assert data["chord_reliable"] is True
    for segment in data["chords"]:
        assert 0.0 <= segment["confidence"] <= 1.0
        assert segment["end"] > segment["start"]
        assert segment["end"] <= data["duration_seconds"] + 0.01
    assert data["chord_method"] == "heuristic-chord-timeline"
    assert data["beats"], "expected a beat grid"
    assert data["meter"] == "4/4"
    assert 0.0 <= float(data["tempo_confidence"]) <= 1.0
    assert data["downbeats"] == [beat["time"] for beat in data["beats"] if beat["downbeat"]]
    assert len(data["beats"]) >= 4


def test_silence_returns_no_reliable_result():
    silence = AudioTensor(np.zeros((1, 22050 * 3), dtype=np.float32), 22050)
    data = analyze(silence).as_dict()
    assert data["chords"] == []
    assert data["chord_reliable"] is False
    assert any("no reliable chord" in note for note in data["notes"])
    assert data["beats"] == []
    assert data["downbeats"] == []


def test_capabilities_do_not_claim_a_transformer_lattice():
    data = analyze(_tone((261.63, 329.63, 392.0), seconds=3.0)).as_dict()
    capabilities = set(data["capabilities"])
    assert "dsp-chord-timeline-heuristic" in capabilities
    assert "dsp-beat-grid-heuristic" in capabilities
    assert "dsp-chord-lattice" not in capabilities
    assert data["analysis_method"] == "dsp-heuristic"


def test_sections_are_labelled_heuristic():
    data = analyze(_tone((220.0, 330.0), seconds=12.0)).as_dict()
    assert data["sections"]
    assert all(section["method"] == "energy-blocks" for section in data["sections"])


def test_report_round_trip_keeps_new_fields():
    report = analyze(_tone((261.63, 329.63, 392.0), seconds=4.0))
    data = report.as_dict()
    for field in (
        "chords",
        "beats",
        "downbeats",
        "chord_method",
        "chord_reliable",
        "meter",
        "tempo_confidence",
        "analysis_method",
    ):
        assert field in data
    assert report.content_key()
