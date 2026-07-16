"""Optional restoration roster (roadmap §6, §15 references).

* :class:`ApolloRestorer` — Apollo-class lossy-codec / bandwidth restoration
  via ``look2hear`` (``BaseModel.from_pretrain("JusperLee/Apollo", ...)``),
  matching the upstream inference script.
* :class:`DeepFilterNetDenoiser` — DeepFilterNet-class real-time denoiser
  (PyPI: ``deepfilternet``, import ``df``).
* :class:`SonicMasterRestorer` — SonicMaster-class all-in-one restoration
  (arXiv 2508.03448); opt-in research checkpoint.

DSP restoration floor (:mod:`neiro.dsp.enhance`) always covers declip/dehum/
denoise/declick/vocal-repair so missing neural backends never block a job.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["ApolloRestorer", "DeepFilterNetDenoiser", "SonicMasterRestorer"]


class ApolloRestorer:
    """Apollo-class restoration: lossy-codec artefact repair / bandwidth recovery."""

    def __init__(
        self, model_id: str = "apollo", checkpoint_path: str | None = None, **_: object
    ) -> None:
        self.checkpoint_path = checkpoint_path or "JusperLee/Apollo"
        self._model = None
        self._device = "cpu"
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=2.0,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "fixes": "lossy-codec artefacts / bandwidth ceiling",
                "backend": "look2hear/Apollo",
                "license_note": (
                    "Apollo weights load from Hugging Face JusperLee/Apollo; "
                    "verify terms before commercial use"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import look2hear.models  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: look2hear/Apollo is not installed. "
                "Install the Apollo/look2hear stack from "
                "https://github.com/JusperLee/Apollo (requires torch + torchaudio), "
                "then `pip install -e .` in that repo so `look2hear` imports. "
                "Until then, 'restore' falls back to AudioSR / DSP floor."
            ) from exc
        self._device = "cuda" if device == "cuda" else "cpu"
        model = look2hear.models.BaseModel.from_pretrain(
            self.checkpoint_path, sr=44100, win=20, feature_dim=256, layer=6
        )
        self._model = model.to(self._device)
        self._model.eval()

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        import torch

        if self._model is None:
            self.load("cpu", "fp32")
        mono = audio.to_mono().samples[0].astype(np.float32)
        tensor = torch.from_numpy(mono).unsqueeze(0).unsqueeze(0).to(self._device)
        with torch.no_grad():
            out = self._model(tensor)
        arr = out.squeeze().detach().cpu().numpy().astype(np.float32)
        if arr.ndim == 1:
            arr = arr[np.newaxis, :]
        return AudioTensor(arr, audio.sample_rate).with_provenance(self.profile.model_id)

    def unload(self) -> None:
        self._model = None


class DeepFilterNetDenoiser:
    """DeepFilterNet-class real-time denoiser (PyPI: ``deepfilternet``, import ``df``)."""

    def __init__(self, model_id: str = "deepfilternet", **_: object) -> None:
        self._model = None
        self._df_state = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.5,
            sample_rate=48000,
            quality_class="reference",
            license_spdx="MIT",
            extras={
                "fixes": "broadband/stationary noise",
                "backend": "deepfilternet",
                "license_note": "DeepFilterNet is MIT-licensed; weights auto-download on first use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            from df.enhance import init_df  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: DeepFilterNet is not installed. Install with "
                "`pip install deepfilternet` (imports as `df`). Until then, 'denoise' falls "
                "back to the RoFormer denoiser (if installed) or the DSP spectral-gate floor."
            ) from exc
        self._model, self._df_state, _ = init_df()

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        import torch
        from df.enhance import enhance as df_enhance

        if self._model is None:
            self.load("cpu", "fp32")
        mono = audio.to_mono().samples[0]
        tensor = torch.from_numpy(mono.astype(np.float32)).unsqueeze(0)
        enhanced = df_enhance(self._model, self._df_state, tensor)
        arr = enhanced.squeeze(0).cpu().numpy().astype(np.float32)[np.newaxis, :]
        out_sr = int(self._df_state.sr()) if hasattr(self._df_state, "sr") else audio.sample_rate
        return AudioTensor(arr, out_sr).with_provenance(self.profile.model_id)

    def unload(self) -> None:
        self._model = None
        self._df_state = None


class SonicMasterRestorer:
    """SonicMaster-class all-in-one restoration + mastering (arXiv 2508.03448)."""

    def __init__(
        self, model_id: str = "sonicmaster", checkpoint_path: str | None = None, **_: object
    ) -> None:
        self.checkpoint_path = checkpoint_path
        self._model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=2.5,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "fixes": "combined restoration + mastering",
                "backend": "sonicmaster",
                "license_note": (
                    "SonicMaster checkpoints are not bundled; no verified-license pip "
                    "package exists at the time of writing — verify terms before "
                    "commercial use once configured"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import sonicmaster  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: SonicMaster is not installed/configured. Neiro "
                "does not bundle a SonicMaster checkpoint (arXiv 2508.03448 is a research "
                "release). Install a package exposing `sonicmaster.inference.load_model` "
                "and set `checkpoint_path`; verify its license before commercial use. Until "
                "then, restoration falls back to Matchering/DSP floor or is skipped."
            ) from exc
        if not self.checkpoint_path:
            raise RuntimeError(f"{self.profile.model_id}: no checkpoint_path configured")
        self._model = sonicmaster.inference.load_model(
            self.checkpoint_path, device="cuda" if device == "cuda" else "cpu"
        )

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        if self._model is None:
            self.load("cpu", "fp32")
        out = self._model.restore(audio.samples, audio.sample_rate)
        return AudioTensor(np.asarray(out, dtype=np.float32), audio.sample_rate).with_provenance(
            self.profile.model_id
        )

    def unload(self) -> None:
        self._model = None
