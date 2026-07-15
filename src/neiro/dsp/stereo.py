"""Mid/side helpers for stereo integrity (roadmap §5.3).

Some separators — mono-only DSP steps, several neural checkpoints trained on
mono-summed data — collapse stereo width. These helpers let a caller process
the mid (M) and side (S) channels independently, or restore width a
mono-collapsing stage lost by re-imposing the source's side-channel character
scaled by the stem's own mask/energy — the "stereo-aware wrapper" the roadmap
calls for, kept as small composable functions rather than a new node family.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

__all__ = ["to_mid_side", "from_mid_side", "process_mid_side", "restore_width"]


def to_mid_side(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Stereo ``(2, n)`` -> ``(mid, side)`` mono arrays. Mono input: side is silence."""
    if samples.shape[0] == 1:
        mid = samples[0].astype(np.float32)
        return mid.copy(), np.zeros_like(mid)
    left, right = samples[0], samples[1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    return mid.astype(np.float32), side.astype(np.float32)


def from_mid_side(mid: np.ndarray, side: np.ndarray) -> np.ndarray:
    """Inverse of :func:`to_mid_side` -> stereo ``(2, n)`` array."""
    left = mid + side
    right = mid - side
    return np.stack([left, right]).astype(np.float32)


def process_mid_side(
    samples: np.ndarray,
    mid_fn: Callable[[np.ndarray], np.ndarray],
    side_fn: Callable[[np.ndarray], np.ndarray] | None = None,
) -> np.ndarray:
    """Run ``mid_fn`` on the mid channel and ``side_fn`` (default: identity) on
    the side channel, then recombine to stereo. Mono input runs ``mid_fn`` only
    and stays mono — there is no side channel to separate.
    """
    if samples.shape[0] == 1:
        return mid_fn(samples[0]).astype(np.float32)[np.newaxis, :]
    mid, side = to_mid_side(samples)
    new_mid = np.asarray(mid_fn(mid), dtype=np.float32)
    new_side = np.asarray(side_fn(side), dtype=np.float32) if side_fn is not None else side
    n = min(new_mid.shape[-1], new_side.shape[-1])
    return from_mid_side(new_mid[:n], new_side[:n])


def restore_width(stem: np.ndarray, source: np.ndarray, *, amount: float = 1.0) -> np.ndarray:
    """Re-impose stereo width on a mono/width-collapsed ``stem`` from ``source``.

    ``stem`` may be ``(1, n)`` mono or a width-collapsed stereo signal (near
    identical L/R). The source's side-channel character is scaled by the
    stem's mid-band magnitude relative to the source's mid channel — a mask —
    and blended back in at ``amount`` (0 = leave collapsed, 1 = full source
    width where the stem is present). Mono sources pass ``stem`` through
    unchanged (there is no width to restore).
    """
    if source.shape[0] < 2:
        return stem.astype(np.float32)
    n = min(stem.shape[-1], source.shape[1])
    stem_mid = (stem[0, :n] if stem.ndim == 2 else stem[:n]).astype(np.float32)
    src_mid, src_side = to_mid_side(source[:, :n])
    mask = np.clip(np.abs(stem_mid) / (np.abs(src_mid) + 1e-8), 0.0, 1.5)
    new_side = src_side * mask * float(amount)
    return from_mid_side(stem_mid, new_side)
