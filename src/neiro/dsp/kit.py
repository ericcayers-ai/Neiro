"""Model-free drum-kit decomposition (roadmap §5.5 "drums deep-dive" DSP floor).

Splits a drum-bus signal into coarse kit-piece proxies by band + transient
character: percussive (HPSS) energy is confined to a frequency band per piece
(kick low, snare/toms low-mid, hats/cymbals high). This is intentionally
coarse — a real drumsep model (``mdx23c-drumsep``) supersedes it via the
registry — but it guarantees ``--preset drums`` / ``drums-deep-dive`` never
hard-fails when no neural model is installed, matching the "DSP floor always
works" requirement for every preset.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import median_filter

from neiro.dsp.separation import istft, stft

__all__ = ["drum_kit_split", "KIT_PIECES"]

# (low_hz, high_hz) bands used to steer each kit piece's share of the
# transient (percussive) energy. Deliberately coarse: real kit pieces overlap
# in frequency far more than this, but the transient gate keeps sustained
# harmonic bleed (bass, guitar) out of every piece.
KIT_PIECES: dict[str, tuple[float, float]] = {
    "kick": (20.0, 150.0),
    "snare": (150.0, 1000.0),
    "toms": (80.0, 400.0),
    "hh": (5000.0, 16000.0),
}


def drum_kit_split(
    samples: np.ndarray, sample_rate: int, n_fft: int = 2048, hop: int = 512
) -> dict[str, np.ndarray]:
    """Return ``{piece_name: (channels, frames)}`` plus an ``"other"`` remainder.

    The remainder is the exact complement (``samples - sum(pieces)``), so the
    decomposition is energy-conserving and usable directly as a residual/null
    test the same way the rest of the DSP separation floor is.
    """
    n = samples.shape[1]
    channels = samples.shape[0]
    freqs = np.fft.rfftfreq(n_fft, 1 / sample_rate)
    band_masks = {name: (freqs >= lo) & (freqs < hi) for name, (lo, hi) in KIT_PIECES.items()}

    out: dict[str, np.ndarray] = {
        name: np.zeros((channels, n), dtype=np.float32) for name in KIT_PIECES
    }
    for ch in range(channels):
        s = stft(samples[ch], n_fft, hop)
        mag = np.abs(s)
        # Vertical median = sustained/harmonic estimate; what's left is transient
        # (percussive) energy — the same estimator as the HPSS split, reused here
        # to keep sustained bleed (bass notes, pads) out of every kit piece.
        sustained = median_filter(mag, size=(1, 9))
        transient = np.clip(mag - sustained, 0.0, None)
        for name, band in band_masks.items():
            piece_mag = np.zeros_like(mag)
            piece_mag[band] = transient[band]
            gain = piece_mag / (mag + 1e-8)
            out[name][ch] = istft(s * gain, n_fft, hop, length=n)

    total = np.zeros((channels, n), dtype=np.float32)
    for arr in out.values():
        total += arr
    out["other"] = (samples.astype(np.float32) - total).astype(np.float32)
    return out
