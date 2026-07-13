"""Adapter for Matchering (``matchering`` package) — reference-based mastering
(roadmap §5.6, §6 "mastering to reference").

Matchering matches a target's RMS, frequency balance, peak, and stereo width to a
reference track. It's an algorithm, not a downloaded model — no weights, so this
adapter is always "downloaded" once the ``matchering`` package is installed.

It differs from the other enhancers in needing a *second* input (the reference).
The reference path is supplied as a constructor param (from the planner / UI),
defaulting to None; with no reference this adapter is a no-op passthrough so a
conditioning chain that includes it never fails — mastering only happens when the
user actually provides a reference.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import soundfile as sf

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["MatcheringEnhancer"]


class MatcheringEnhancer:
    def __init__(
        self,
        model_id: str = "matchering",
        reference_path: str | None = None,
        **_: object,
    ) -> None:
        self.reference_path = reference_path
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=0.1,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="GPL-3.0",
            extras={
                "fixes": "loudness / tone / width to match a reference",
                "backend": "matchering",
                "needs_reference": True,
                "license_note": "matchering is GPL-3.0 — copyleft; keep in mind for distribution",
            },
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        if not self.reference_path or not Path(self.reference_path).exists():
            # No reference supplied — pass through unchanged rather than error.
            return audio.with_provenance("matchering:no-reference-passthrough")

        import matchering as mg

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "target.wav"
            result = Path(tmp) / "mastered.wav"
            sf.write(str(target), audio.samples.T, audio.sample_rate)
            mg.process(
                target=str(target),
                reference=str(self.reference_path),
                results=[mg.pcm24(str(result))],
            )
            data, sr = sf.read(str(result), dtype="float32", always_2d=True)
        return AudioTensor(data.T.copy(), sr).with_provenance(self.profile.model_id)

    def unload(self) -> None:
        return None
