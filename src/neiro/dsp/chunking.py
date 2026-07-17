"""Chunked processing with overlap-add (roadmap §3.1, §5.3).

Neural separators often cannot fit a whole song in VRAM. The VRAM manager may
shrink the effective chunk via ``chunk_scale``; this module splits audio into
overlapping windows, runs a separator on each, and crossfades the results.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

from neiro.engine.artifacts import AudioTensor

__all__ = ["separate_chunked", "chunk_starts"]


def _hann(n: int) -> np.ndarray:
    if n <= 1:
        return np.ones(max(n, 1), dtype=np.float32)
    return np.hanning(n).astype(np.float32)


def _align_1d(x: np.ndarray, length: int) -> np.ndarray:
    """Crop or zero-pad a 1-D array to ``length``."""
    if x.shape[0] == length:
        return x
    if x.shape[0] > length:
        return x[:length]
    out = np.zeros(length, dtype=x.dtype)
    out[: x.shape[0]] = x
    return out


def chunk_starts(total: int, chunk_frames: int, hop: int) -> list[int]:
    """Return chunk start frames, never leaving a tiny trailing stub.

    A low overlap (e.g. draft tier at 10%) can leave a final window of only a
    second or two. RoFormer backends crash on those short tails, so the last
    start is pulled back to end exactly at ``total`` with a full-size window.
    """
    if total <= chunk_frames:
        return [0]
    starts: list[int] = []
    start = 0
    while start + chunk_frames < total:
        starts.append(start)
        start += hop
    last = max(0, total - chunk_frames)
    if not starts or last != starts[-1]:
        starts.append(last)
    return starts


def separate_chunked(
    separate_fn: Callable[[AudioTensor], dict[str, AudioTensor]],
    audio: AudioTensor,
    *,
    chunk_seconds: float = 30.0,
    overlap: float = 0.25,
    chunk_scale: float = 1.0,
) -> dict[str, AudioTensor]:
    """Run ``separate_fn`` on overlapping chunks and fuse stem outputs."""
    scale = max(0.25, min(1.0, chunk_scale))
    chunk_s = max(1.0, chunk_seconds * scale)
    chunk_frames = int(chunk_s * audio.sample_rate)
    hop = max(1, int(chunk_frames * (1.0 - overlap)))
    total = audio.frames

    if total <= chunk_frames or chunk_frames < audio.sample_rate:
        return separate_fn(audio)

    stem_names: list[str] | None = None
    accum: dict[str, np.ndarray] = {}
    weight_sum = np.zeros(total, dtype=np.float32)

    for start in chunk_starts(total, chunk_frames, hop):
        end = min(total, start + chunk_frames)
        chunk = AudioTensor(audio.samples[:, start:end], audio.sample_rate)
        stems = separate_fn(chunk)
        if stem_names is None:
            stem_names = list(stems.keys())
            for name in stem_names:
                accum[name] = np.zeros((audio.channels, total), dtype=np.float32)

        n = end - start
        win = _hann(n)
        for ch in range(audio.channels):
            weight_sum[start:end] += win
            for name in stem_names:
                stem = stems[name].samples
                ch_data = stem[ch] if stem.shape[0] > ch else stem[0]
                accum[name][ch, start:end] += _align_1d(ch_data, n) * win

    weight_sum = np.maximum(weight_sum, 1e-8)
    out: dict[str, AudioTensor] = {}
    for name in stem_names or []:
        fused = accum[name] / weight_sum[np.newaxis, :]
        out[name] = AudioTensor(fused.astype(np.float32), audio.sample_rate)
    return out
