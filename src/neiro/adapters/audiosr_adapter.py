"""Adapter for AudioSR (``audiosr`` package) — audio super-resolution / bandwidth
extension to 48 kHz (roadmap §6 restoration, "bandwidth extension").

Verified against the upstream source: ``audiosr.build_model(model_name=...)`` and
``audiosr.super_resolution(model, input_file, ...)`` returning a 48 kHz waveform;
checkpoints auto-download from the Hugging Face Hub via ``huggingface_hub`` inside
``build_model``. The manifest marks this as a ``managed`` weight so
``ensure_downloaded`` triggers that fetch once through Neiro's tracking.

Availability note: the ``audiosr`` package pins dependencies that fail to build
on Python 3.12 in some environments (a transitive dep uses a ``pkgutil`` API
removed in 3.12). The manifest's ``requires: ["audiosr"]`` means the registry
reports it unavailable wherever it isn't importable — the app degrades to the
DSP restoration floor rather than breaking. The adapter code is correct and runs
wherever ``audiosr`` installs (e.g. Python 3.10/3.11).
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["AudioSRAdapter"]


class AudioSRAdapter:
    def __init__(
        self,
        model_id: str = "audiosr",
        model_name: str = "basic",
        ddim_steps: int = 50,
        guidance_scale: float = 3.5,
        **_: object,
    ) -> None:
        self.model_name = model_name
        self.ddim_steps = int(ddim_steps)
        self.guidance_scale = float(guidance_scale)
        self._model = None
        self._device = "cpu"
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=3.5,
            sample_rate=48000,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "fixes": "bandwidth / low sample rate",
                "backend": "audiosr",
                "output_sr": 48000,
                "license_note": "AudioSR weights are research-oriented; verify terms before commercial use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        from audiosr import build_model

        self._device = "cuda" if device == "cuda" else "cpu"
        self._model = build_model(model_name=self.model_name, device=self._device)

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        import tempfile
        from pathlib import Path

        import soundfile as sf
        from audiosr import super_resolution

        if self._model is None:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            in_path = Path(tmp) / "in.wav"
            sf.write(str(in_path), audio.to_mono().samples[0], audio.sample_rate)
            waveform = super_resolution(
                self._model,
                str(in_path),
                seed=42,
                ddim_steps=self.ddim_steps,
                guidance_scale=self.guidance_scale,
            )
        arr = np.asarray(waveform, dtype=np.float32)
        arr = np.squeeze(arr)
        if arr.ndim == 1:
            arr = arr[np.newaxis, :]
        return AudioTensor(arr, 48000).with_provenance(self.profile.model_id)

    def unload(self) -> None:
        self._model = None
