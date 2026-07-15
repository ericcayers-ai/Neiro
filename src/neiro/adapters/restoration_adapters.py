"""Optional restoration roster (roadmap §6, §15 references).

Three generative restoration backends, all opt-in and all gracefully absent
when their package isn't installed — the DSP restoration floor
(:mod:`neiro.dsp.enhance`) always covers the same conditions (declip, dehum,
denoise, declick, vocal repair) so none of these being missing ever blocks a
job, per the task's "neural models are opt-in; DSP floor must always work"
constraint.

* :class:`ApolloRestorer` — Apollo-class lossy-codec / bandwidth restoration
  (roadmap §6.2: "16 kHz codec ceiling -> suggest Apollo before separation").
* :class:`DeepFilterNetDenoiser` — DeepFilterNet-class real-time denoiser;
  the ``deepfilternet`` package (PyPI: ``deepfilternet``, import name ``df``)
  is a real, installable dependency, so this adapter's :meth:`load`/
  :meth:`enhance` are a best-effort real integration rather than a pure stub.
* :class:`SonicMasterRestorer` — SonicMaster-class all-in-one restoration +
  mastering (arXiv 2508.03448).

None of these ship a bundled checkpoint: every one downloads (or is pointed
at) weights the *user* fetches, per roadmap principle 2 (nothing restricted
ships in the package).
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
        self.checkpoint_path = checkpoint_path
        self._model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=2.0,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "fixes": "lossy-codec artefacts / bandwidth ceiling",
                "backend": "apollo",
                "license_note": (
                    "Apollo checkpoints are not bundled; no verified-license "
                    "pip package exists at the time of writing — verify terms "
                    "before commercial use once configured"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import apollo  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: Apollo is not installed/configured. Neiro does "
                "not bundle an Apollo checkpoint. Install a package exposing "
                "`apollo.inference.load_model` and set `checkpoint_path` in the manifest; "
                "verify its license before commercial use. Until then, restoration falls "
                "back to the DSP floor (declip/dehum/denoise) or is skipped."
            ) from exc
        if not self.checkpoint_path:
            raise RuntimeError(f"{self.profile.model_id}: no checkpoint_path configured")
        self._model = apollo.inference.load_model(
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
