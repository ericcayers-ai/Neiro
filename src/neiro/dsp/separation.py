"""Model-free separation primitives.

These implement genuinely useful separation with nothing but numpy/scipy, so the
tool does something real on first launch before any weights are downloaded:

* :func:`center_extract` — frequency-domain azimuth masking that pulls the
  centre-panned signal (typically lead vocals + centred bass/snare) out of a
  stereo mix, and its complement. This is the classic "vocal / instrumental"
  proxy, done per time-frequency bin rather than the crude L-R trick.
* :func:`harmonic_percussive` — median-filtering HPSS (Fitzgerald, 2010): a
  horizontal median on the spectrogram isolates sustained/harmonic content, a
  vertical median isolates transient/percussive content.
* :func:`residual` — exact time-domain ``source - sum(stems)``. For a complete
  decomposition this is the null test; a loud residual means a stem was dropped.

The neural backends (Demucs, RoFormer, …) plug in through the registry and
supersede these when installed; the interface the rest of the engine sees is the
same either way.
"""

from __future__ import annotations

import math

import numpy as np
from scipy.signal import get_window
from scipy.ndimage import median_filter

__all__ = ["stft", "istft", "center_extract", "harmonic_percussive", "residual"]


def stft(x: np.ndarray, n_fft: int = 4096, hop: int = 1024, window: str = "hann") -> np.ndarray:
    """STFT of a 1-D signal -> complex array (freq_bins, frames)."""
    win = get_window(window, n_fft, fftbins=True).astype(np.float32)
    n = len(x)
    # ceil-based frame count so the final window covers the tail of the signal.
    n_frames = 1 + max(0, math.ceil((n - n_fft) / hop)) if n >= n_fft else 1
    pad = max(0, (n_frames - 1) * hop + n_fft - n)
    xp = np.pad(x, (0, pad))
    frames = np.lib.stride_tricks.sliding_window_view(xp, n_fft)[::hop]
    frames = frames * win
    return np.fft.rfft(frames, axis=1).T.astype(np.complex64)


def istft(
    spec: np.ndarray,
    n_fft: int = 4096,
    hop: int = 1024,
    window: str = "hann",
    length: int | None = None,
) -> np.ndarray:
    """Inverse STFT with overlap-add and window normalisation."""
    win = get_window(window, n_fft, fftbins=True).astype(np.float32)
    frames = np.fft.irfft(spec.T, n=n_fft, axis=1).astype(np.float32)
    n_frames = frames.shape[0]
    out_len = (n_frames - 1) * hop + n_fft
    out = np.zeros(out_len, dtype=np.float32)
    wsum = np.zeros(out_len, dtype=np.float32)
    for i in range(n_frames):
        start = i * hop
        out[start : start + n_fft] += frames[i] * win
        wsum[start : start + n_fft] += win ** 2
    nonzero = wsum > 1e-8
    out[nonzero] /= wsum[nonzero]
    if length is not None:
        if out.shape[0] < length:
            out = np.pad(out, (0, length - out.shape[0]))
        out = out[:length]
    return out


def _stereo(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if samples.shape[0] == 1:
        return samples[0], samples[0].copy()
    return samples[0], samples[1]


def center_extract(
    samples: np.ndarray,
    sample_rate: int,
    n_fft: int = 4096,
    hop: int = 1024,
    strength: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Split a stereo signal into (centre, sides) by per-bin panning similarity.

    Returns two ``(channels, frames)`` float32 arrays: the extracted centre
    ("vocals" proxy) and its complement ("instrumental"). For mono input the
    centre is the whole signal and the complement is silence.
    """
    n = samples.shape[1]
    if samples.shape[0] == 1:
        centre = samples.copy()
        sides = np.zeros_like(samples)
        return centre.astype(np.float32), sides.astype(np.float32)

    L, R = _stereo(samples)
    SL = stft(L, n_fft, hop)
    SR = stft(R, n_fft, hop)

    magL = np.abs(SL)
    magR = np.abs(SR)
    # Similarity in [0, 1]: 1 where L and R magnitudes match (centre-panned).
    sim = 1.0 - np.abs(magL - magR) / (magL + magR + 1e-8)
    mask = np.clip(sim, 0.0, 1.0) ** (2.0 * max(strength, 1e-3))

    centre_L = istft(SL * mask, n_fft, hop, length=n)
    centre_R = istft(SR * mask, n_fft, hop, length=n)
    inv = 1.0 - mask
    sides_L = istft(SL * inv, n_fft, hop, length=n)
    sides_R = istft(SR * inv, n_fft, hop, length=n)

    centre = np.stack([centre_L, centre_R]).astype(np.float32)
    sides = np.stack([sides_L, sides_R]).astype(np.float32)
    return centre, sides


def harmonic_percussive(
    samples: np.ndarray,
    sample_rate: int,
    n_fft: int = 4096,
    hop: int = 1024,
    kernel: int = 31,
    power: float = 2.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Median-filtering HPSS. Returns (harmonic, percussive), same shape as input."""
    n = samples.shape[1]
    harm_channels = []
    perc_channels = []
    for ch in range(samples.shape[0]):
        S = stft(samples[ch], n_fft, hop)
        mag = np.abs(S)
        phase = np.exp(1j * np.angle(S))
        # Horizontal median -> harmonic; vertical median -> percussive.
        H = median_filter(mag, size=(1, kernel))
        P = median_filter(mag, size=(kernel, 1))
        Hp = H ** power
        Pp = P ** power
        denom = Hp + Pp + 1e-8
        mask_h = Hp / denom
        mask_p = Pp / denom
        harm_channels.append(istft(S * mask_h, n_fft, hop, length=n))
        perc_channels.append(istft(S * mask_p, n_fft, hop, length=n))
    harmonic = np.stack(harm_channels).astype(np.float32)
    percussive = np.stack(perc_channels).astype(np.float32)
    return harmonic, percussive


def residual(source: np.ndarray, stems: list[np.ndarray]) -> np.ndarray:
    """Time-domain ``source - sum(stems)``; the null-test / "everything else" track."""
    acc = np.zeros_like(source, dtype=np.float32)
    for s in stems:
        m = min(acc.shape[1], s.shape[1])
        chans = min(acc.shape[0], s.shape[0])
        acc[:chans, :m] += s[:chans, :m]
    return (source - acc).astype(np.float32)
