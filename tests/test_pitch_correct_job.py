"""Pitch-correct job cancel + planner enhance auto_download honesty."""

from __future__ import annotations

import numpy as np
import pytest

from neiro.dsp import edit as ed
from neiro.engine.artifacts import AudioTensor
from neiro.engine.graph import CancelledError
from neiro.engine.planner import plan_enhancement
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager


def _tone(seconds: float = 1.0, sr: int = 22050, freq: float = 220.0) -> AudioTensor:
    t = np.arange(int(seconds * sr)) / sr
    # Slightly off-pitch so pitch_correct has work to do
    sig = (0.35 * np.sin(2 * np.pi * (freq * 1.03) * t)).astype(np.float32)
    return AudioTensor(sig[np.newaxis, :], sr)


def test_pitch_correct_cancel_check_raises():
    a = _tone(1.5)

    def always_cancel() -> bool:
        return True

    with pytest.raises(CancelledError):
        ed.pitch_correct(a, strength=1.0, cancel_check=always_cancel)


def test_pitch_correct_strength_zero_ignores_cancel():
    a = _tone(0.5)
    out = ed.pitch_correct(a, strength=0.0, cancel_check=lambda: True)
    assert out.samples.shape == a.samples.shape


def test_plan_enhancement_auto_download_does_not_silent_skip_undownloaded(tmp_path):
    """When auto_download=True, undownloaded neural steps must download or needs-install — not silent skip."""
    sr = 16000
    wav = tmp_path / "t.wav"
    samples = 0.1 * np.random.randn(2, sr).astype(np.float32)
    import soundfile as sf

    sf.write(str(wav), samples.T, sr)

    plan = plan_enhancement(
        wav,
        default_registry(),
        VRAMManager(),
        chain=["denoise"],
        auto_download=True,
    )
    # Either applied a denoise model, or noted needs-install — never bare "not downloaded; skipping"
    assert not any("not downloaded; skipping" in n for n in plan.notes)
    blob = " ".join(plan.notes).lower()
    assert (
        plan.chain
        or "needs-install" in blob
        or "downloading" in blob
        or "using" in blob
        or "dsp" in blob
    )
