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
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import filtfilt, iirnotch

from neiro.dsp.separation import istft, stft

__all__ = [
    "declip",
    "remove_hum",
    "spectral_gate",
    "peak_normalize",
    "declick",
    "vocal_repair",
]


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


def _click_runs(x: np.ndarray, threshold: float, max_len: int) -> list[tuple[int, int]]:
    """Short (<= max_len samples) high-derivative runs — impulsive clicks/pops.

    Unlike :func:`declip`'s amplitude-ceiling detector, clicks are detected by
    a large sample-to-sample jump (the signature of a dropped sample, vinyl
    pop, or digital edit glitch) regardless of absolute level, then bounded to
    short runs so sustained loud transients (drum hits) are never mistaken for
    clicks.
    """
    d = np.abs(np.diff(x, prepend=x[:1]))
    local = maximum_filter1d(np.abs(x), size=9)
    mask = d >= threshold * (local + 1e-6)
    if not mask.any():
        return []
    idx = np.flatnonzero(mask)
    splits = np.where(np.diff(idx) > 1)[0]
    starts = np.concatenate(([idx[0]], idx[splits + 1]))
    ends = np.concatenate((idx[splits] + 1, [idx[-1] + 1]))
    return [(s, e) for s, e in zip(starts.tolist(), ends.tolist(), strict=True) if e - s <= max_len]


def declick(samples: np.ndarray, sample_rate: int, threshold: float = 3.0, max_click_ms: float = 3.0) -> np.ndarray:
    """Remove short impulsive clicks/pops (vinyl, digital-edit glitches).

    Detects runs of samples whose derivative jumps well past their local
    envelope (``threshold`` x) and no longer than ``max_click_ms``, then
    reconstructs them with a cubic spline through the surrounding clean
    samples — the same interpolation strategy as :func:`declip`, applied to a
    different detector so genuine sustained transients (drums, plucks) are
    left alone.
    """
    out = samples.astype(np.float32).copy()
    n = out.shape[1]
    max_len = max(2, int(max_click_ms / 1000.0 * sample_rate))
    context = max(4, int(0.0005 * sample_rate))
    for ch in range(out.shape[0]):
        x = out[ch]
        for start, end in _click_runs(x, threshold, max_len):
            left = np.arange(max(0, start - context), start)
            right = np.arange(end, min(n, end + context))
            support = np.concatenate([left, right])
            gap = np.arange(start, end)
            if support.size >= 4 and left.size and right.size:
                spline = CubicSpline(support, x[support])
                x[gap] = spline(gap)
            elif support.size:
                x[gap] = x[support[np.argmin(np.abs(support - (start + end) / 2))]]
        out[ch] = x
    return out


def vocal_repair(
    samples: np.ndarray,
    sample_rate: int,
    *,
    declick_threshold: float = 3.0,
    deess_db: float = 6.0,
    deess_lo: float = 5000.0,
    deess_hi: float = 9000.0,
) -> np.ndarray:
    """DSP floor for "vocal repair" (roadmap §6 restoration roster).

    A vocal-tuned chain: de-click (edit glitches / breath-noise clicks), then a
    gentle de-esser — a soft compressor on the 5-9 kHz sibilance band only,
    driven by that band's own envelope so plosives/sibilance are tamed without
    dulling the rest of the vocal. This is intentionally conservative; a
    neural vocal-repair model (when installed) supersedes it via the registry
    the same way Apollo supersedes DSP declip.
    """
    out = declick(samples, sample_rate, threshold=declick_threshold)
    n = out.shape[1]
    n_fft, hop = 2048, 512
    reduction = 10 ** (-deess_db / 20.0)
    for ch in range(out.shape[0]):
        S = stft(out[ch], n_fft, hop)
        mag = np.abs(S)
        freqs = np.fft.rfftfreq(n_fft, 1 / sample_rate)
        band = (freqs >= deess_lo) & (freqs <= deess_hi)
        if not band.any():
            continue
        band_env = mag[band].mean(axis=0)
        floor = np.percentile(band_env, 40) + 1e-9
        excess = np.clip(band_env / floor - 1.0, 0.0, None)
        gain = 1.0 / (1.0 + excess)  # soft-knee attenuation, driven by sibilance excess
        gain = reduction + (1.0 - reduction) * gain
        gain = uniform_filter1d(gain, size=3)
        mask = np.ones_like(mag)
        mask[band] = gain[np.newaxis, :]
        out[ch] = istft(S * mask, n_fft, hop, length=n)
    return out.astype(np.float32)
