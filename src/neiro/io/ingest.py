"""Dynamic data ingest (roadmap §3.1).

Reads any media file into an :class:`AudioTensor`. WAV/FLAC/OGG and friends go
through libsndfile (soundfile); anything else (MP3/AAC/M4A/video containers) is
decoded through ffmpeg to a temporary WAV first. Sample-rate *lanes* are produced
lazily via polyphase resampling: 44.1 kHz stereo for separation, 16 kHz mono for
sequence models, etc. Lanes are cheap, deterministic transforms so they slot into
the content-addressed cache.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd

from neiro.engine.artifacts import AudioTensor

__all__ = ["load_audio", "make_lane", "SNDFILE_EXTS"]

# Extensions libsndfile handles directly; everything else routes through ffmpeg.
SNDFILE_EXTS = {".wav", ".flac", ".ogg", ".aiff", ".aif", ".w64", ".caf"}


def _decode_with_ffmpeg(path: Path) -> tuple[np.ndarray, int]:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            f"cannot decode {path.suffix} files without ffmpeg on PATH "
            "(install ffmpeg or supply WAV/FLAC input)"
        )
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "decoded.wav"
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(path),
            "-map", "a:0",
            "-c:a", "pcm_f32le",
            str(wav_path),
        ]
        subprocess.run(cmd, check=True)
        data, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    return data.T.copy(), sr


def load_audio(path: str | Path) -> AudioTensor:
    """Load ``path`` into an AudioTensor at its native sample rate."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    if path.suffix.lower() in SNDFILE_EXTS:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        samples = data.T.copy()
    else:
        samples, sr = _decode_with_ffmpeg(path)
    return AudioTensor(samples, sr, provenance=(f"ingest:{path.name}",))


def make_lane(
    audio: AudioTensor, target_sr: int, *, mono: bool = False
) -> AudioTensor:
    """Resample (and optionally downmix) to produce a processing lane."""
    samples = audio.samples
    if mono and samples.shape[0] > 1:
        samples = samples.mean(axis=0, keepdims=True)
    if audio.sample_rate != target_sr:
        g = gcd(audio.sample_rate, target_sr)
        up = target_sr // g
        down = audio.sample_rate // g
        samples = resample_poly(samples, up, down, axis=1).astype(np.float32)
    return AudioTensor(
        samples.astype(np.float32),
        target_sr,
        provenance=audio.provenance + (f"lane:{target_sr}{'m' if mono else 's'}",),
    )
