"""Optional Demucs backend (roadmap §5.1 fast lane).

This adapter is only usable when the ``demucs`` extra is installed
(``pip install neiro[demucs]``). It imports torch/demucs lazily inside
:meth:`load` so the core engine never depends on them. When the package is
absent the registry simply skips this manifest and the DSP separators remain the
default — the app still runs.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["DemucsSeparator"]


class DemucsSeparator:
    STEMS = ("drums", "bass", "other", "vocals")

    def __init__(self, model_id: str = "htdemucs", variant: str = "htdemucs", **_: object) -> None:
        self.variant = variant
        self._model = None
        self._apply_model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=self.STEMS,
            fp32_gb=4.0,
            fp16_gb=2.2,
            supports_fp16=True,
            sample_rate=44100,
            quality_class="standard",
            license_spdx="MIT",
            extras={"backend": "demucs", "variant": variant},
        )

    def load(self, device: str, precision: str) -> None:
        from demucs.pretrained import get_model  # type: ignore
        from demucs.apply import apply_model  # type: ignore

        self._model = get_model(self.variant)
        self._model.to("cuda" if device == "cuda" else "cpu")
        self._model.eval()
        self._apply_model = apply_model

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        import torch

        if self._model is None:
            self.load("cpu", "fp32")
        wav = torch.from_numpy(audio.samples).float()
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            sources = self._apply_model(self._model, wav[None], device=next(self._model.parameters()).device)[0]
        sources = sources * ref.std() + ref.mean()
        out: dict[str, AudioTensor] = {}
        for name, arr in zip(self._model.sources, sources.cpu().numpy()):
            out[name] = AudioTensor(arr.astype(np.float32), audio.sample_rate).with_provenance(
                self.profile.model_id
            )
        return out

    def unload(self) -> None:
        self._model = None
        self._apply_model = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
