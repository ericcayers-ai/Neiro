"""Ensemble transcription adapter (registry-facing shell for ``tr-ensemble-default``).

The planner prefers expanding this manifest into parallel :class:`TranscribeNode`
members + :class:`~neiro.nodes.audio_nodes.EnsembleComposeNode` so progress
reports per member. This class remains instantiable for registry probing and
CLI ``neiro download`` / availability checks: it resolves ``model_id`` members
from the default registry and fuses them with :func:`ensemble_merge`.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["EnsembleTranscriber"]


class EnsembleTranscriber:
    def __init__(
        self,
        model_id: str = "tr-ensemble-default",
        members: list[dict] | None = None,
        **_: object,
    ) -> None:
        if not members:
            raise ValueError("ensemble transcription requires at least one member spec")
        self.member_specs = list(members)
        self._resolved: list[tuple[object, float]] | None = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=sum(float(m.get("vram_gb", 0.5)) for m in members) or 1.0,
            sample_rate=16000,
            channels=1,
            quality_class="reference",
            license_spdx="MIT",
            extras={
                "members": [m.get("model_id") or m.get("adapter") for m in members],
                "mode": "ensemble_merge",
            },
        )

    def _resolve_members(self) -> list[tuple[object, float]]:
        if self._resolved is not None:
            return self._resolved
        from neiro.engine.registry import default_registry

        reg = default_registry()
        resolved: list[tuple[object, float]] = []
        for spec in self.member_specs:
            weight = float(spec.get("weight", 1.0))
            mid = spec.get("model_id")
            if mid:
                try:
                    entry = reg.get(mid)
                except KeyError:
                    continue
                if not entry.available():
                    continue
                if entry.needs_download and not entry.downloaded():
                    continue
                resolved.append((entry.instantiate(), weight))
                continue
            # Inline adapter path (same shape as separation ensembles).
            adapter = spec.get("adapter")
            if not adapter:
                continue
            import importlib

            module_name, _, class_name = adapter.partition(":")
            cls = getattr(importlib.import_module(module_name), class_name)
            params = dict(spec.get("params", {}))
            resolved.append((cls(**params), weight))
        if not resolved:
            raise RuntimeError(
                f"{self.profile.model_id}: no ensemble members available "
                "(install decoder extras or pick installed models)"
            )
        self._resolved = resolved
        return resolved

    def load(self, device: str, precision: str) -> None:
        for member, _ in self._resolve_members():
            member.load(device, precision)

    def unload(self) -> None:
        if self._resolved is None:
            return
        for member, _ in self._resolved:
            member.unload()

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        from neiro.symbolic.orchestrate import ensemble_merge, tag_provenance

        streams: list[NoteStream] = []
        weights: list[float] = []
        for member, weight in self._resolve_members():
            stream = member.transcribe(audio)
            mid = getattr(getattr(member, "profile", None), "model_id", "") or ""
            streams.append(tag_provenance(stream, mid))
            weights.append(weight)
        return ensemble_merge(streams, weights=weights)
