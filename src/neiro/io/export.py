"""Stem export (roadmap §5.6)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from neiro.engine.artifacts import AudioTensor

__all__ = ["write_audio"]

_SUBTYPES = {
    ("wav", 16): "PCM_16",
    ("wav", 24): "PCM_24",
    ("wav", 32): "FLOAT",
    ("flac", 16): "PCM_16",
    ("flac", 24): "PCM_24",
}


def write_audio(
    audio: AudioTensor,
    path: str | Path,
    *,
    fmt: str = "wav",
    bit_depth: int = 24,
) -> Path:
    """Write an AudioTensor to disk. Returns the written path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    subtype = _SUBTYPES.get((fmt, bit_depth))
    if subtype is None:
        raise ValueError(f"unsupported format/bit-depth: {fmt}/{bit_depth}")
    data = np.clip(audio.samples.T, -1.0, 1.0) if bit_depth != 32 else audio.samples.T
    sf.write(str(path), data, audio.sample_rate, subtype=subtype)
    return path
