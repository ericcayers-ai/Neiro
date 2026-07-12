"""Model-free restoration primitives (roadmap §6 — the always-available floor).

* :func:`declip` — detects saturated runs and re-draws them with a cubic spline
  fitted to the clean samples on both sides. Classical, artefact-free for the
  mild-to-moderate clipping the analysis pass flags.
* :func:`remove_hum` — cascaded IIR notches at the mains fundamental and its
  harmonics (50/60 Hz families), zero-phase filtered.
* :func:`spectral_gate` — noise reduction by spectral gating: the noise profile
  is estimated from the quietest frames per frequency bin, then a smoothed
  soft mask attenuates bins near that floor.

Generative restoration (Apollo, AudioSR, …) plugs in through the registry and
supersedes these where installed; the Enhancer interface is identical.
"""

from __future__ import annotations

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.ndimage import uniform_filter1d
from scipy.signal import filtfilt, iirnotch

from neiro.dsp.separation import istft, stft

__all__ = ["declip", "remove_hum", "spectral_gate", "peak_normalize"]


def _clipped_runs(x: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    """Contiguous index runs where |x| >= threshold. Returns [(start, end)) )."""
    mask = np.abs(x) >= threshold
    if not mask.any():
        return []
    idx = np.flatnonzero(mask)
    splits = np.where(np.diff(idx) > 1)[0]
    starts = np.concatenate(([idx[0]], idx[splits + 1]))
    ends = np.concatenate((idx[splits] + 1, [idx[-1] + 1]))
    return list(zip(starts.tolist(), ends.tolist(), strict=True))


def declip(samples: np.ndarray, threshold: float = 0.985, context: int = 8) -> np.ndarray:
    """Reconstruct clipped regions channel by channel.

    For each saturated run, a cubic spline is fitted through up to ``context``
    clean samples on each side and evaluated across the run. Runs touching the
    signal edges fall back to holding the neighbouring clean value.
    """
    out = samples.astype(np.float32).copy()
    n = out.shape[1]
    for ch in range(out.shape[0]):
        x = out[ch]
        for start, end in _clipped_runs(x, threshold):
            left = np.arange(max(0, start - context), start)
            right = np.arange(end, min(n, end + context))
            left = left[np.abs(x[left]) < threshold] if left.size else left
            right = right[np.abs(x[right]) < threshold] if right.size else right
            support = np.concatenate([left, right])
            gap = np.arange(start, end)
            if support.size >= 4 and left.size and right.size:
                spline = CubicSpline(support, x[support])
                x[gap] = spline(gap)
            elif support.size:
                x[gap] = x[support[np.argmin(np.abs(support - (start + end) / 2))]]
        out[ch] = x
    return out


def remove_hum(
    samples: np.ndarray,
    sample_rate: int,
    fundamental: float = 60.0,
    harmonics: int = 8,
    q: float = 35.0,
) -> np.ndarray:
    """Notch out mains hum at ``fundamental`` and its harmonics (zero-phase)."""
    out = samples.astype(np.float64)
    nyquist = sample_rate / 2
    for k in range(1, harmonics + 1):
        f = fundamental * k
        if f >= nyquist * 0.95:
            break
        b, a = iirnotch(f, q, fs=sample_rate)
        out = filtfilt(b, a, out, axis=1)
    return out.astype(np.float32)


def spectral_gate(
    samples: np.ndarray,
    sample_rate: int,
    n_fft: int = 2048,
    hop: int = 512,
    reduction_db: float = 18.0,
    noise_percentile: float = 20.0,
) -> np.ndarray:
    """Broadband noise reduction by spectral gating.

    The per-bin noise floor is the ``noise_percentile`` of frame magnitudes; bins
    below ~2x that floor are attenuated by up to ``reduction_db``, with the mask
    smoothed across time and frequency to avoid musical-noise artefacts.
    """
    n = samples.shape[1]
    floor_gain = 10 ** (-reduction_db / 20.0)
    out = np.empty_like(samples, dtype=np.float32)
    for ch in range(samples.shape[0]):
        S = stft(samples[ch], n_fft, hop)
        mag = np.abs(S)
        noise = np.percentile(mag, noise_percentile, axis=1, keepdims=True)
        # Soft mask: 0 at the noise floor, 1 from 4x the floor upward.
        ratio = (mag - 2.0 * noise) / (2.0 * noise + 1e-12)
        mask = np.clip(ratio, 0.0, 1.0)
        mask = uniform_filter1d(mask, size=5, axis=1)  # time smoothing
        mask = uniform_filter1d(mask, size=3, axis=0)  # frequency smoothing
        gain = floor_gain + (1.0 - floor_gain) * mask
        out[ch] = istft(S * gain, n_fft, hop, length=n)
    return out


def peak_normalize(samples: np.ndarray, target_dbfs: float = -1.0) -> np.ndarray:
    """Scale so the absolute peak sits at ``target_dbfs``. Silence passes through."""
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-9:
        return samples.astype(np.float32)
    gain = 10 ** (target_dbfs / 20.0) / peak
    return (samples * gain).astype(np.float32)
