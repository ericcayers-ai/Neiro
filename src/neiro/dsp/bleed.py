"""Bleed suppression (roadmap §5.3).

A post-separation pass that estimates how much of a *rival* stem's spectral
energy leaked ("bled") into a target stem, and attenuates that estimate with
an adaptive per-bin gain. It runs on whatever stems a separator already
produced — model-agnostic, always available, and always A/B-able: callers
keep the un-suppressed stems around (nothing here is destructive, roadmap
principle 6) and can compare before/after with :func:`bleed_estimate_db`.

Because it is pure DSP it must never be the thing standing between a Draft-tier
job and a usable result — :mod:`neiro.engine.planner` always runs this pass
when bleed suppression is requested, in every quality tier including Draft
(see ``plan_separation(..., bleed_suppress=...)``).
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.separation import istft, stft

__all__ = ["suppress_bleed", "suppress_bleed_multi", "bleed_estimate_db"]


def suppress_bleed(
    target: np.ndarray,
    rivals: list[np.ndarray],
    sample_rate: int,
    *,
    strength: float = 0.6,
    n_fft: int = 4096,
    hop: int = 1024,
    floor_db: float = -18.0,
) -> np.ndarray:
    """Attenuate rival-stem energy leaking into ``target``.

    For every rival, a per-bin ratio ``|rival| / (|target| + |rival|)`` estimates
    how much a time-frequency bin looks like it belongs to the rival rather than
    the target; the target's magnitude is reduced by ``strength`` times that
    estimate (soft spectral subtraction), phase untouched. ``floor_db`` bounds
    the attenuation so a bin can never be fully muted — that would trade bleed
    for musical-noise / total-silence artefacts, which is worse.

    ``target``/``rivals`` are ``(channels, frames)`` float arrays; rivals may
    have a different channel count (mono stems broadcast against a stereo
    target) but must share the same frame count and sample rate.
    """
    if not rivals:
        return target.astype(np.float32).copy()
    n = target.shape[1]
    floor_gain = 10 ** (floor_db / 20.0)
    out = np.empty_like(target, dtype=np.float32)
    for ch in range(target.shape[0]):
        s_target = stft(target[ch], n_fft, hop)
        mag_t = np.abs(s_target)
        bleed_mag = np.zeros_like(mag_t)
        for rival in rivals:
            r_ch = rival[ch] if rival.shape[0] > ch else rival[0]
            s_rival = stft(r_ch, n_fft, hop)
            mag_r = np.abs(s_rival)
            denom = mag_t + mag_r + 1e-8
            ratio = mag_r / denom
            # A rival can only explain as much of a bin as the target itself has.
            bleed_mag = np.maximum(bleed_mag, ratio * mag_t)
        gain = 1.0 - strength * (bleed_mag / (mag_t + 1e-8))
        gain = np.clip(gain, floor_gain, 1.0)
        out[ch] = istft(s_target * gain, n_fft, hop, length=n)
    return out.astype(np.float32)


def suppress_bleed_multi(
    stems: dict[str, np.ndarray],
    sample_rate: int,
    *,
    strength: float = 0.6,
    n_fft: int = 4096,
    hop: int = 1024,
    floor_db: float = -18.0,
) -> dict[str, np.ndarray]:
    """Run :func:`suppress_bleed` for every named stem against all the others."""
    names = list(stems)
    out: dict[str, np.ndarray] = {}
    for name in names:
        rivals = [stems[other] for other in names if other != name]
        out[name] = suppress_bleed(
            stems[name],
            rivals,
            sample_rate,
            strength=strength,
            n_fft=n_fft,
            hop=hop,
            floor_db=floor_db,
        )
    return out


def bleed_estimate_db(target: np.ndarray, rivals: list[np.ndarray]) -> float:
    """Rough scalar bleed estimate: rival/target covariance energy ratio, in dB.

    Positive and closer to 0 dB means more of the rivals' energy correlates
    with (i.e. likely bled into) the target; very negative means little bleed
    evidence. Intended as an A/B diagnostic, not a perceptual metric.
    """
    if not rivals:
        return -np.inf
    t_energy = float(np.mean(target.astype(np.float64) ** 2)) + 1e-12
    bleed_energy = 0.0
    for r in rivals:
        m = min(target.shape[1], r.shape[1])
        chans = min(target.shape[0], r.shape[0])
        prod = target[:chans, :m].astype(np.float64) * r[:chans, :m].astype(np.float64)
        bleed_energy += max(0.0, float(np.mean(prod)))
    return float(10 * np.log10((bleed_energy + 1e-12) / t_energy))
