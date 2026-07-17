"""A Separator built from other separators (roadmap §5.3).

Members are declared in the manifest as adapter import paths with parameters and
weights — an ensemble is itself just a manifest, no core changes. Each member
runs (optionally with TTA) and the outputs are fused on complex spectrograms.
"""

from __future__ import annotations

import importlib

import numpy as np

from neiro.dsp.ensemble import fuse_stems, tta_separate
from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["EnsembleSeparator", "TTASeparator"]


def _instantiate(spec: dict):
    module_name, _, class_name = spec["adapter"].partition(":")
    cls = getattr(importlib.import_module(module_name), class_name)
    params = dict(spec.get("params", {}))
    return cls(**params)


class EnsembleSeparator:
    def __init__(
        self,
        model_id: str = "ensemble",
        members: list[dict] | None = None,
        mode: str = "mean",
        tta: bool = True,
        chunk_seconds: float | None = None,
        **_: object,
    ):
        if not members:
            raise ValueError("ensemble requires at least one member spec")
        self.members = [_instantiate(m) for m in members]
        self.weights = [float(m.get("weight", 1.0)) for m in members]
        self.mode = mode
        self.tta = bool(tta)

        stems = self.members[0].profile.stems
        for m in self.members[1:]:
            if m.profile.stems != stems:
                raise ValueError("ensemble members must share a stem set")
        # Prefer an explicit chunk size (manifest), else the longest member hint.
        member_chunks = [m.profile.chunk_seconds for m in self.members]
        resolved_chunk = float(chunk_seconds) if chunk_seconds is not None else max(member_chunks)
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=stems,
            fp32_gb=sum(m.profile.fp32_gb for m in self.members),
            sample_rate=self.members[0].profile.sample_rate,
            chunk_seconds=resolved_chunk,
            quality_class="standard",
            license_spdx="MIT",
            extras={
                "members": [m.profile.model_id for m in self.members],
                "mode": mode,
                "tta": self.tta,
            },
        )

    def load(self, device: str, precision: str) -> None:
        for m in self.members:
            m.load(device, precision)

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        # Draft tier zeroes all but the strongest weight — skip those members
        # entirely so we never pay for (or crash on) a zero-contribution run.
        active = [(m, w) for m, w in zip(self.members, self.weights, strict=True) if w > 0.0]
        if not active:
            top = max(range(len(self.weights)), key=lambda i: self.weights[i])
            active = [(self.members[top], 1.0)]

        member_outputs: list[dict[str, np.ndarray]] = []
        active_weights: list[float] = []
        target_frames = audio.frames
        for m, w in active:
            stems = tta_separate(m, audio) if self.tta else m.separate(audio)
            cropped: dict[str, np.ndarray] = {}
            for k, v in stems.items():
                s = v.samples
                if s.shape[-1] > target_frames:
                    s = s[..., :target_frames]
                elif s.shape[-1] < target_frames:
                    pad = np.zeros(s.shape[:-1] + (target_frames - s.shape[-1],), dtype=s.dtype)
                    s = np.concatenate([s, pad], axis=-1)
                cropped[k] = s
            member_outputs.append(cropped)
            active_weights.append(w)
        fused = fuse_stems(
            member_outputs, audio.sample_rate, weights=active_weights, mode=self.mode
        )
        return {
            name: AudioTensor(arr, audio.sample_rate).with_provenance(self.profile.model_id)
            for name, arr in fused.items()
        }

    def unload(self) -> None:
        for m in self.members:
            m.unload()


class TTASeparator:
    """Wraps any single :class:`Separator` with test-time augmentation.

    Lets quality-tier wiring (roadmap §5.2/§5.3, ``plan_separation(quality=…)``)
    turn TTA on for a preset that resolved to a plain (non-ensemble) model —
    e.g. Standard/Reference tiers on the ``vocals`` preset before any neural
    ensemble is installed — without every adapter needing its own TTA logic.
    """

    def __init__(self, inner) -> None:
        self.inner = inner
        self.profile = inner.profile

    def load(self, device: str, precision: str) -> None:
        self.inner.load(device, precision)

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        return tta_separate(self.inner, audio)

    def unload(self) -> None:
        self.inner.unload()
