"""Perceptual enhancement metric (roadmap §12 PEAQ/ViSQOL-class proxy)."""

import numpy as np

from neiro.eval.metrics import perceptual_distance


def test_identical_signals_near_zero_perceptual_distance():
    sr = 16000
    t = np.arange(sr) / sr
    x = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    score = perceptual_distance(x, x, sample_rate=sr)
    assert score.combined < 1e-6
    assert score.loudness_error_db < 1e-6


def test_noisy_estimate_has_higher_distance():
    sr = 16000
    t = np.arange(sr) / sr
    ref = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    noisy = ref + 0.05 * np.random.randn(ref.size).astype(np.float32)
    clean = perceptual_distance(ref, ref, sample_rate=sr)
    dirty = perceptual_distance(noisy, ref, sample_rate=sr)
    assert dirty.combined > clean.combined
