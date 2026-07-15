"""Enhancer adapters backed by :mod:`neiro.dsp.enhance` — no downloads required."""

from __future__ import annotations

from neiro.dsp.enhance import (
    declick,
    declip,
    peak_normalize,
    remove_hum,
    spectral_gate,
    vocal_repair,
)
from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = [
    "DeclipEnhancer",
    "DehumEnhancer",
    "DenoiseEnhancer",
    "NormalizeEnhancer",
    "DeclickEnhancer",
    "VocalRepairEnhancer",
]


class _DspEnhancer:
    task = "enhance"

    def load(self, device: str, precision: str) -> None:
        return None

    def unload(self) -> None:
        return None

    def _wrap(self, samples, audio: AudioTensor) -> AudioTensor:
        return AudioTensor(samples, audio.sample_rate).with_provenance(self.profile.model_id)


class DeclipEnhancer(_DspEnhancer):
    def __init__(self, model_id: str = "dsp-declip", threshold: float = 0.985, **_: object):
        self.threshold = float(threshold)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.02,
            quality_class="draft",
            license_spdx="MIT",
            extras={"fixes": "clipping", "method": "cubic-spline reconstruction"},
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        return self._wrap(declip(audio.samples, threshold=self.threshold), audio)


class DehumEnhancer(_DspEnhancer):
    def __init__(
        self,
        model_id: str = "dsp-dehum",
        fundamental: float = 60.0,
        harmonics: int = 8,
        **_: object,
    ):
        self.fundamental = float(fundamental)
        self.harmonics = int(harmonics)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.02,
            quality_class="draft",
            license_spdx="MIT",
            extras={"fixes": "mains hum", "method": "harmonic notch cascade"},
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        cleaned = remove_hum(
            audio.samples,
            audio.sample_rate,
            fundamental=self.fundamental,
            harmonics=self.harmonics,
        )
        return self._wrap(cleaned, audio)


class DenoiseEnhancer(_DspEnhancer):
    def __init__(self, model_id: str = "dsp-denoise", reduction_db: float = 18.0, **_: object):
        self.reduction_db = float(reduction_db)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.05,
            quality_class="draft",
            license_spdx="MIT",
            extras={"fixes": "broadband noise", "method": "spectral gating"},
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        cleaned = spectral_gate(audio.samples, audio.sample_rate, reduction_db=self.reduction_db)
        return self._wrap(cleaned, audio)


class NormalizeEnhancer(_DspEnhancer):
    def __init__(self, model_id: str = "dsp-normalize", target_dbfs: float = -1.0, **_: object):
        self.target_dbfs = float(target_dbfs)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.01,
            quality_class="draft",
            license_spdx="MIT",
            extras={"fixes": "level", "method": "peak normalization"},
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        return self._wrap(peak_normalize(audio.samples, self.target_dbfs), audio)


class DeclickEnhancer(_DspEnhancer):
    def __init__(self, model_id: str = "dsp-declick", threshold: float = 3.0, **_: object):
        self.threshold = float(threshold)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.02,
            quality_class="draft",
            license_spdx="MIT",
            extras={"fixes": "impulsive clicks/pops", "method": "derivative-gated spline repair"},
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        cleaned = declick(audio.samples, audio.sample_rate, threshold=self.threshold)
        return self._wrap(cleaned, audio)


class VocalRepairEnhancer(_DspEnhancer):
    def __init__(
        self,
        model_id: str = "dsp-vocal-repair",
        deess_db: float = 6.0,
        **_: object,
    ):
        self.deess_db = float(deess_db)
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.05,
            quality_class="draft",
            license_spdx="MIT",
            extras={
                "fixes": "vocal-take glitches (clicks, harsh sibilance)",
                "method": "declick + sibilance-band soft compressor",
            },
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        repaired = vocal_repair(audio.samples, audio.sample_rate, deess_db=self.deess_db)
        return self._wrap(repaired, audio)
