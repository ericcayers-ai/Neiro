"""Non-destructive edit operations for the built-in audio editor (roadmap §9.1).

Every function takes an :class:`AudioTensor` and returns a new one — the input is
never mutated, matching the roadmap's non-destructive principle (nothing edits the
source; edits produce new artifacts). Regions are given in seconds and clamped to
the signal bounds, so out-of-range selections degrade gracefully rather than
raising.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.enhance import peak_normalize
from neiro.engine.artifacts import AudioTensor

__all__ = [
    "trim",
    "delete_region",
    "silence_region",
    "gain",
    "fade",
    "reverse",
    "normalize",
]


def _clamp(audio: AudioTensor, start_s: float, end_s: float) -> tuple[int, int]:
    a = max(0, min(audio.frames, int(round(start_s * audio.sample_rate))))
    b = max(0, min(audio.frames, int(round(end_s * audio.sample_rate))))
    if b < a:
        a, b = b, a
    return a, b


def trim(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Keep only the region [start_s, end_s); discard the rest."""
    a, b = _clamp(audio, start_s, end_s)
    return AudioTensor(audio.samples[:, a:b].copy(), audio.sample_rate).with_provenance(
        f"trim({start_s:.3f},{end_s:.3f})"
    )


def delete_region(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Remove the region [start_s, end_s), splicing the surrounding audio."""
    a, b = _clamp(audio, start_s, end_s)
    kept = np.concatenate([audio.samples[:, :a], audio.samples[:, b:]], axis=1)
    return AudioTensor(kept.copy(), audio.sample_rate).with_provenance(
        f"delete({start_s:.3f},{end_s:.3f})"
    )


def silence_region(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Zero the region [start_s, end_s) in place-length (keeps duration)."""
    a, b = _clamp(audio, start_s, end_s)
    out = audio.samples.copy()
    out[:, a:b] = 0.0
    return AudioTensor(out, audio.sample_rate).with_provenance(
        f"silence({start_s:.3f},{end_s:.3f})"
    )


def gain(
    audio: AudioTensor, db: float, start_s: float | None = None, end_s: float | None = None
) -> AudioTensor:
    """Apply ``db`` gain, to a region if given, else the whole signal."""
    factor = 10 ** (db / 20.0)
    out = audio.samples.copy()
    if start_s is None or end_s is None:
        out *= factor
    else:
        a, b = _clamp(audio, start_s, end_s)
        out[:, a:b] *= factor
    return AudioTensor(out.astype(np.float32), audio.sample_rate).with_provenance(
        f"gain({db:+.1f}dB)"
    )


def fade(audio: AudioTensor, start_s: float, end_s: float, *, direction: str = "in") -> AudioTensor:
    """Apply a linear fade in or out across [start_s, end_s)."""
    a, b = _clamp(audio, start_s, end_s)
    out = audio.samples.copy()
    n = b - a
    if n > 0:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        if direction == "out":
            ramp = ramp[::-1]
        out[:, a:b] *= ramp
    return AudioTensor(out, audio.sample_rate).with_provenance(f"fade-{direction}")


def reverse(audio: AudioTensor) -> AudioTensor:
    """Reverse the signal in time."""
    return AudioTensor(audio.samples[:, ::-1].copy(), audio.sample_rate).with_provenance("reverse")


def normalize(audio: AudioTensor, target_dbfs: float = -1.0) -> AudioTensor:
    """Peak-normalize to ``target_dbfs``."""
    return AudioTensor(
        peak_normalize(audio.samples, target_dbfs), audio.sample_rate
    ).with_provenance(f"normalize({target_dbfs:+.1f}dBFS)")
