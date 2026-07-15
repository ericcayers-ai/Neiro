"""Fault-injection / robustness tests (roadmap §12)."""

from __future__ import annotations

import io
import struct
import wave
from pathlib import Path

import pytest

from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import CancelledError, ExecutionContext
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager
from neiro.io import load_audio


def _write_tone(path: Path, seconds=0.5, sr=16000):
    import math

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(
            struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * n / sr)))
            for n in range(int(seconds * sr))
        )
        w.writeframes(frames)


def test_corrupt_wav_raises(tmp_path: Path):
    bad = tmp_path / "corrupt.wav"
    bad.write_bytes(b"RIFF....notreally")
    with pytest.raises(Exception):
        load_audio(bad)


def test_missing_model_falls_back_or_errors_clearly():
    reg = default_registry()
    try:
        entry = reg.get("this-model-does-not-exist-xyz")
        assert entry is None
    except KeyError:
        pass  # honest miss — KeyError is acceptable for unknown ids


def test_cancel_mid_separation(tmp_path: Path):
    from neiro.engine.planner import plan_separation

    wav = tmp_path / "t.wav"
    _write_tone(wav, seconds=1.0)
    plan = plan_separation(wav, "vocals", default_registry(), VRAMManager())
    ctx = ExecutionContext(cache=ArtifactCache())
    ctx.cancel()
    with pytest.raises(CancelledError):
        plan.graph.execute(ctx, targets=[plan.separate_node])


def test_cache_corruption_evicted(tmp_path: Path):
    cache = ArtifactCache(max_entries=4, disk_dir=tmp_path / "cache")
    key = "deadbeef" * 4
    junk = cache.disk_dir / f"{key}.pkl"
    junk.write_bytes(b"not-a-pickle")
    # get_or_compute should ignore corrupt disk entry
    val = cache.get_or_compute(key, lambda: {"ok": True})
    assert val == {"ok": True}
