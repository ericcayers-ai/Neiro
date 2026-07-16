"""Optional LarsNet drum-kit separator (roadmap §5.1).

LarsNet is a research drum-separation network (kick/snare/toms/hats/cymbals).
No pip-installable inference package ships verified-license weights today, so
this adapter mirrors :mod:`neiro.adapters.scnet_adapter`: the registry reports
unavailable until a package exposing ``larsnet.inference.load_model`` is
installed and a ``checkpoint_path`` is configured. Presets that list
``larsnet`` fall through to ``mdx23c-drumsep`` / ``dsp-drumkit``.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["LarsNetSeparator"]

_INSTALL_HINT = (
    "LarsNet is not installed/configured. Neiro does not bundle LarsNet weights "
    "(no packaged inference library or verified-license checkpoint on PyPI). "
    "Install a package exposing `larsnet.inference.load_model`, set "
    "`checkpoint_path` in the manifest, and verify that checkpoint's license. "
    "Until then, drum presets fall back to mdx23c-drumsep or dsp-drumkit."
)


class LarsNetSeparator:
    STEMS = ("kick", "snare", "toms", "hh", "cymbals")

    def __init__(
        self,
        model_id: str = "larsnet",
        checkpoint_path: str | None = None,
        **_: object,
    ) -> None:
        self.checkpoint_path = checkpoint_path
        self._model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=self.STEMS,
            fp32_gb=3.0,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "backend": "larsnet",
                "license_note": (
                    "LarsNet checkpoints are not bundled; verify the specific "
                    "checkpoint's license before commercial use"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import larsnet  # type: ignore
        except ImportError as exc:
            raise RuntimeError(f"{self.profile.model_id}: {_INSTALL_HINT}") from exc
        if not self.checkpoint_path:
            raise RuntimeError(
                f"{self.profile.model_id}: no checkpoint_path configured. {_INSTALL_HINT}"
            )
        self._model = larsnet.inference.load_model(
            self.checkpoint_path, device="cuda" if device == "cuda" else "cpu"
        )

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        if self._model is None:
            self.load("cpu", "fp32")
        raw = self._model.separate(audio.samples, audio.sample_rate)
        return {
            name: AudioTensor(np.asarray(arr, dtype=np.float32), audio.sample_rate).with_provenance(
                self.profile.model_id
            )
            for name, arr in raw.items()
        }

    def unload(self) -> None:
        self._model = None
