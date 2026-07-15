"""Tests for post-separation bleed suppression (roadmap §5.3, item 2)."""

from __future__ import annotations

import numpy as np

from neiro.dsp.bleed import bleed_estimate_db, suppress_bleed, suppress_bleed_multi


def _tone(freq: float, seconds: float, sr: int) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return np.sin(2 * np.pi * freq * t).astype(np.float32)


def test_suppress_bleed_reduces_rival_energy(sr):
    # Target is a clean 220 Hz tone; "bleed" is a co-mixed 900 Hz rival tone
    # leaking into the target's channel at a lower level.
    target = 0.6 * _tone(220.0, 1.0, sr)
    rival_clean = 0.6 * _tone(900.0, 1.0, sr)
    leaked = target + 0.4 * rival_clean
    target_arr = leaked[np.newaxis, :]
    rival_arr = rival_clean[np.newaxis, :]

    out = suppress_bleed(target_arr, [rival_arr], sr, strength=0.8)
    assert out.shape == target_arr.shape
    assert out.dtype == np.float32

    # Band-limited energy around the rival frequency should drop after suppression.
    def band_energy(x, sr, f0, half_bw=40.0):
        spec = np.fft.rfft(x)
        freqs = np.fft.rfftfreq(x.shape[-1], 1.0 / sr)
        mask = (freqs > f0 - half_bw) & (freqs < f0 + half_bw)
        return float(np.sum(np.abs(spec[..., mask]) ** 2))

    before = band_energy(target_arr[0], sr, 900.0)
    after = band_energy(out[0], sr, 900.0)
    assert after < before * 0.6


def test_suppress_bleed_no_rivals_is_passthrough(sr):
    target = (0.5 * _tone(440.0, 0.5, sr))[np.newaxis, :]
    out = suppress_bleed(target, [], sr)
    assert np.allclose(out, target, atol=1e-6)


def test_suppress_bleed_never_fully_silences(sr):
    """floor_db bounds attenuation: even a rival identical to the target
    must leave *some* signal (roadmap: never trade bleed for total silence)."""
    target = (0.6 * _tone(300.0, 0.5, sr))[np.newaxis, :]
    rival = target.copy()  # worst case: rival == target exactly
    out = suppress_bleed(target, [rival], sr, strength=1.0, floor_db=-18.0)
    floor_gain = 10 ** (-18.0 / 20.0)
    # Peak of output should be roughly >= floor_gain * peak of input (not zeroed).
    assert np.max(np.abs(out)) > floor_gain * np.max(np.abs(target)) * 0.5


def test_suppress_bleed_multi_covers_every_stem(sr):
    a = (0.5 * _tone(220.0, 0.5, sr))[np.newaxis, :]
    b = (0.5 * _tone(440.0, 0.5, sr))[np.newaxis, :]
    c = (0.5 * _tone(880.0, 0.5, sr))[np.newaxis, :]
    stems = {"vocals": a, "drums": b, "other": c}
    out = suppress_bleed_multi(stems, sr, strength=0.5)
    assert set(out) == set(stems)
    for name in stems:
        assert out[name].shape == stems[name].shape
        assert out[name].dtype == np.float32


def test_suppress_bleed_multi_stereo_mix(stereo_mix):
    # Exercise the multi-channel path against the shared stereo fixture.
    stems = {
        "left_biased": stereo_mix.samples,
        "right_biased": np.roll(stereo_mix.samples, 1, axis=1),
    }
    out = suppress_bleed_multi(stems, stereo_mix.sample_rate, strength=0.6)
    for name, arr in out.items():
        assert arr.shape == stems[name].shape


def test_bleed_estimate_db_ranks_correlated_higher():
    rng = np.random.default_rng(0)
    target = rng.normal(size=(1, 4096)).astype(np.float32)
    correlated = target + 0.05 * rng.normal(size=target.shape).astype(np.float32)
    uncorrelated = rng.normal(size=target.shape).astype(np.float32)

    db_correlated = bleed_estimate_db(target, [correlated])
    db_uncorrelated = bleed_estimate_db(target, [uncorrelated])
    assert db_correlated > db_uncorrelated


def test_bleed_estimate_db_no_rivals_is_negative_infinity():
    target = np.zeros((1, 100), dtype=np.float32)
    assert bleed_estimate_db(target, []) == -np.inf
