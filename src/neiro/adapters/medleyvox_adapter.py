"""Optional Medley Vox backend — multi-singer / overlapping-vocals separation.

Roadmap §4.2: "multi-singer overlap... routes to Medley Vox"; §15 references
(https://mvsep.com/algorithms/60). Medley Vox separates two (or more)
simultaneous singers from one vocal-dominant signal — a different problem
than lead/backing karaoke split, which is why it gets its own stems
(``singer1``/``singer2``) rather than reusing ``vocals``/``instrumental``.

As with :mod:`neiro.adapters.scnet_adapter`, no checkpoint is bundled: the
upstream project (https://github.com/khanhkhanhlele/MedleyVox and forks) is a
research codebase, not a pip package with a clearly-licensed release weight.
The manifest's ``requires: ["medley_vox"]`` makes the registry report this
unavailable until a package + checkpoint are actually configured, so the
``duet-vocals`` preset falls back to a plain vocal/instrumental split (which
won't separate the two singers, but never fails) rather than crashing.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["MedleyVoxSeparator"]

_INSTALL_HINT = (
    "Medley Vox is not installed/configured. Neiro does not bundle a Medley Vox "
    "checkpoint (research codebase, no packaged pip release at the time of "
    "writing) — see https://mvsep.com/algorithms/60. Install a package "
    "exposing `medley_vox.inference.load_model`, set `checkpoint_path` in the "
    "manifest, and verify that checkpoint's license before commercial use. "
    "Until then, 'duet-vocals' falls back to a single vocal/instrumental split."
)


class MedleyVoxSeparator:
    STEMS = ("singer1", "singer2", "instrumental")

    def __init__(
        self,
        model_id: str = "medley-vox",
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
                "backend": "medley_vox",
                "license_note": (
                    "Medley Vox checkpoints are not bundled; verify the specific "
                    "checkpoint's license before commercial use"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import medley_vox  # type: ignore
        except ImportError as exc:
            raise RuntimeError(f"{self.profile.model_id}: {_INSTALL_HINT}") from exc
        if not self.checkpoint_path:
            raise RuntimeError(
                f"{self.profile.model_id}: no checkpoint_path configured. {_INSTALL_HINT}"
            )
        self._model = medley_vox.inference.load_model(
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
