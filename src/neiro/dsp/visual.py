"""Waveform and spectrogram data for the editor UI (roadmap §9.1).

The engine computes compact, display-ready representations so the browser can
render at 60 fps without shipping raw samples:

* :func:`waveform_peaks` — per-pixel min/max envelope (the classic waveform look),
  bucketed to a target column count.
* :func:`spectrogram_image` — a log-frequency, dB-scaled magnitude grid quantised
  to bytes, sized for a canvas. The frontend maps it through a colormap.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.separation import stft
from neiro.engine.artifacts import AudioTensor

__all__ = ["waveform_peaks", "spectrogram_image"]


def waveform_peaks(
    audio: AudioTensor,
    width: int = 1200,
    *,
    start: float | None = None,
    end: float | None = None,
) -> dict:
    """Return per-column min/max peaks of the mono mixdown, in [-1, 1].

    Optional ``start``/``end`` (seconds) zoom into a time window so the UI can
    request denser peaks for a zoomed viewport without shipping the full file.
    """
    width = max(1, min(width, audio.frames or 1))
    mono = audio.samples.mean(axis=0)
    n = mono.size
    duration = audio.duration_seconds
    if n == 0:
        return {"width": 0, "min": [], "max": [], "duration": 0.0}
    if start is not None or end is not None:
        sr = audio.sample_rate
        a0 = 0 if start is None else max(0, min(n, int(round(float(start) * sr))))
        b0 = n if end is None else max(0, min(n, int(round(float(end) * sr))))
        if b0 < a0:
            a0, b0 = b0, a0
        if b0 == a0:
            b0 = min(n, a0 + 1)
        mono = mono[a0:b0]
        n = mono.size
    edges = np.linspace(0, n, width + 1, dtype=int)
    mins = np.empty(width, dtype=np.float32)
    maxs = np.empty(width, dtype=np.float32)
    for i in range(width):
        a, b = edges[i], max(edges[i] + 1, edges[i + 1])
        seg = mono[a:b]
        mins[i] = float(seg.min())
        maxs[i] = float(seg.max())
    return {
        "width": width,
        "min": np.round(mins, 4).tolist(),
        "max": np.round(maxs, 4).tolist(),
        "duration": duration,
    }


def spectrogram_image(
    audio: AudioTensor,
    *,
    max_frames: int = 800,
    freq_bins: int = 256,
    top_db: float = 80.0,
    fmax: float | None = None,
) -> dict:
    """Return a quantised log-frequency spectrogram.

    ``data`` is a row-major ``rows x cols`` byte grid (row 0 = highest frequency),
    values 0–255 mapping [-top_db, 0] dBFS. Frequencies are mapped onto a log axis
    so bass detail is visible, matching how the editor displays it.
    """
    sr = audio.sample_rate
    mono = audio.samples.mean(axis=0)
    n_fft = 2048
    hop = max(1, mono.size // max_frames) if mono.size > max_frames * 4 else 512
    S = np.abs(stft(mono, n_fft=n_fft, hop=hop))
    if S.shape[1] > max_frames:
        idx = np.linspace(0, S.shape[1] - 1, max_frames).astype(int)
        S = S[:, idx]

    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    fmax = fmax or sr / 2
    fmin = 40.0
    # Log-spaced frequency band edges from fmin..fmax.
    log_edges = np.logspace(np.log10(fmin), np.log10(fmax), freq_bins + 1)
    rows = np.zeros((freq_bins, S.shape[1]), dtype=np.float32)
    for r in range(freq_bins):
        lo, hi = log_edges[r], log_edges[r + 1]
        mask = (freqs >= lo) & (freqs < hi)
        if mask.any():
            rows[r] = S[mask].mean(axis=0)
        elif r > 0:
            rows[r] = rows[r - 1]  # thin high-frequency bands borrow neighbours

    ref = rows.max() + 1e-12
    db = 20 * np.log10(rows / ref + 1e-12)
    db = np.clip(db, -top_db, 0.0)
    quant = ((db + top_db) / top_db * 255).astype(np.uint8)
    # Row 0 = highest frequency for natural top-down display.
    quant = quant[::-1]
    return {
        "rows": int(freq_bins),
        "cols": int(S.shape[1]),
        "fmin": fmin,
        "fmax": float(fmax),
        "duration": audio.duration_seconds,
        "data": quant.reshape(-1).tolist(),
    }
