"""Optional SCNet / SCNet-XL backend (roadmap §5.1, §15 references: SCNet).

SCNet ("Sparse Compression Network") is a research separation architecture
(https://github.com/yoyololicon/SCNet). Neiro does **not** bundle any SCNet
checkpoint: the reference repo doesn't ship a pip-installable inference
package or a clearly-licensed pretrained weight file, so packaging one here
would mean either vendoring restricted weights or silently depending on a
package that doesn't exist on PyPI. Both violate roadmap principle 7
("the core never imports a model repository directly... its successor is a
JSON file and a weights download, not a release") if done carelessly, so
instead:

* This adapter imports an ``scnet`` inference package *lazily*, only in
  :meth:`load`. If it isn't installed, the registry's ``available()`` check
  (driven by the manifest's ``requires: ["scnet"]``) already reports this
  model unavailable and every preset that lists it falls back to the next
  entry in its preference list, down to the DSP floor — never a crash.
* If someone instantiates this adapter directly without the package (or
  without a configured checkpoint), :meth:`load` raises a ``RuntimeError``
  with the exact install/config gap, not a bare ``ImportError`` traceback.

To use a real SCNet checkpoint: obtain (and verify the license of) a
checkpoint from the community, install an inference package that exposes
``scnet.inference.load_model(path, device=...) -> model`` with a
``model.separate(samples, sample_rate) -> {stem: array}`` method, and point
the manifest's ``checkpoint_path`` param at it.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["SCNetSeparator"]

_INSTALL_HINT = (
    "SCNet is not installed/configured. Neiro does not bundle SCNet weights "
    "(no packaged inference library or verified-license checkpoint exists on "
    "PyPI at the time of writing) — see https://github.com/yoyololicon/SCNet. "
    "Install a package exposing `scnet.inference.load_model`, set "
    "`checkpoint_path` in the manifest, and verify that checkpoint's own "
    "license before commercial use. Until then, presets that list scnet fall "
    "back to the next available model (htdemucs, or the DSP floor)."
)


class SCNetSeparator:
    STEMS = ("drums", "bass", "other", "vocals")

    def __init__(
        self,
        model_id: str = "scnet",
        checkpoint_path: str | None = None,
        variant: str = "scnet",
        **_: object,
    ) -> None:
        self.checkpoint_path = checkpoint_path
        self.variant = variant
        self._model = None
        vram = {
            "scnet": (3.5, 2.0),
            "scnet-xl": (6.0, 3.5),
            "scnet-xl-ihf": (7.0, 4.0),
        }.get(variant, (3.5, 2.0))
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=self.STEMS,
            fp32_gb=vram[0],
            fp16_gb=vram[1],
            supports_fp16=True,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "backend": "scnet",
                "variant": variant,
                "license_note": (
                    "SCNet checkpoints are not bundled; verify the specific "
                    "checkpoint's license before commercial use"
                ),
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import scnet  # type: ignore
        except ImportError as exc:
            raise RuntimeError(f"{self.profile.model_id}: {_INSTALL_HINT}") from exc
        if not self.checkpoint_path:
            raise RuntimeError(
                f"{self.profile.model_id}: no checkpoint_path configured. {_INSTALL_HINT}"
            )
        self._model = scnet.inference.load_model(
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
