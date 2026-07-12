"""Ensemble fusion and test-time augmentation (roadmap §5.3).

Fusion happens on complex spectrograms: member magnitudes are combined per
time-frequency bin (weighted mean / median / max / min) while phase is taken
from the highest-weighted member. ``max`` favours recall of the target stem;
``min`` favours purity. TTA runs a separator on de-correlated views of the input
(polarity inversion, channel swap) and averages the de-augmented outputs.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.separation import istft, stft
from neiro.engine.artifacts import AudioTensor

__all__ = ["fuse_stems", "tta_separate", "FUSION_MODES"]

FUSION_MODES = ("mean", "median", "max", "min")


def fuse_stems(
    members: list[dict[str, np.ndarray]],
    sample_rate: int,
    *,
    weights: list[float] | None = None,
    mode: str = "mean",
    n_fft: int = 4096,
    hop: int = 1024,
) -> dict[str, np.ndarray]:
    """Fuse per-member stem dictionaries into one set of stems.

    Every member must provide the same stem names with identically shaped
    ``(channels, frames)`` arrays. Phase comes from the highest-weighted member.
    """
    if not members:
        raise ValueError("no ensemble members")
    if mode not in FUSION_MODES:
        raise ValueError(f"unknown fusion mode {mode!r}; expected one of {FUSION_MODES}")
    names = set(members[0])
    for m in members[1:]:
        if set(m) != names:
            raise ValueError("ensemble members disagree on stem names")
    if weights is None:
        weights = [1.0] * len(members)
    if len(weights) != len(members):
        raise ValueError("weights/members length mismatch")
    w = np.asarray(weights, dtype=np.float64)
    w = w / w.sum()
    phase_ref = int(np.argmax(w))

    fused: dict[str, np.ndarray] = {}
    for name in names:
        arrays = [m[name] for m in members]
        channels, frames = arrays[0].shape
        out = np.empty((channels, frames), dtype=np.float32)
        for ch in range(channels):
            specs = [stft(a[ch], n_fft, hop) for a in arrays]
            mags = np.stack([np.abs(s) for s in specs])
            if mode == "mean":
                mag = np.tensordot(w, mags, axes=1)
            elif mode == "median":
                mag = np.median(mags, axis=0)
            elif mode == "max":
                mag = mags.max(axis=0)
            else:  # min
                mag = mags.min(axis=0)
            phase = np.exp(1j * np.angle(specs[phase_ref]))
            out[ch] = istft(mag * phase, n_fft, hop, length=frames)
        fused[name] = out
    return fused


def tta_separate(separator, audio: AudioTensor) -> dict[str, AudioTensor]:
    """Run a separator with test-time augmentation and average the results.

    Augmentations: identity, polarity inversion, and (for stereo) channel swap.
    Each output is de-augmented before averaging, so the result stays aligned.
    """
    views: list[tuple[str, AudioTensor]] = [("id", audio)]
    views.append(("inv", AudioTensor(-audio.samples, audio.sample_rate)))
    if audio.channels == 2:
        views.append(("swap", AudioTensor(audio.samples[::-1].copy(), audio.sample_rate)))

    accumulated: dict[str, np.ndarray] = {}
    for kind, view in views:
        stems = separator.separate(view)
        for name, art in stems.items():
            s = art.samples
            if kind == "inv":
                s = -s
            elif kind == "swap" and s.shape[0] == 2:
                s = s[::-1]
            accumulated[name] = accumulated.get(name, 0) + s / len(views)

    return {
        name: AudioTensor(arr.astype(np.float32), audio.sample_rate).with_provenance(
            f"tta:{separator.profile.model_id}"
        )
        for name, arr in accumulated.items()
    }
