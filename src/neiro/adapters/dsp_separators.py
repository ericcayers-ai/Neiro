"""Separator adapters backed by :mod:`neiro.dsp` — no model downloads required.

These are the M0 default separators. They satisfy the same :class:`Separator`
protocol as the neural backends, so the planner, VRAM manager, and cache treat
them identically. Their ``fp32_gb`` footprints are ~0 because they run on CPU
with bounded memory; they always pass admission control.
"""

from __future__ import annotations

from neiro.dsp import center_extract, drum_kit_split, harmonic_percussive
from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["CenterSeparator", "HpssSeparator", "DrumKitSeparator"]


class CenterSeparator:
    """Vocals / instrumental via frequency-domain centre extraction."""

    def __init__(self, model_id: str = "dsp-center", strength: float = 1.0, **_: object) -> None:
        self.strength = float(strength)
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=("vocals", "instrumental"),
            fp32_gb=0.05,
            sample_rate=44100,
            quality_class="draft",
            license_spdx="MIT",
            extras={"method": "azimuth-mask", "note": "centre-channel proxy"},
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        centre, sides = center_extract(audio.samples, audio.sample_rate, strength=self.strength)
        return {
            "vocals": AudioTensor(centre, audio.sample_rate).with_provenance(self.profile.model_id),
            "instrumental": AudioTensor(sides, audio.sample_rate).with_provenance(
                self.profile.model_id
            ),
        }

    def unload(self) -> None:
        return None


class HpssSeparator:
    """Harmonic / percussive split via median-filtering HPSS."""

    def __init__(self, model_id: str = "dsp-hpss", kernel: int = 31, **_: object) -> None:
        self.kernel = int(kernel)
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=("harmonic", "percussive"),
            fp32_gb=0.05,
            sample_rate=44100,
            quality_class="draft",
            license_spdx="MIT",
            extras={"method": "median-hpss"},
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        harm, perc = harmonic_percussive(audio.samples, audio.sample_rate, kernel=self.kernel)
        return {
            "harmonic": AudioTensor(harm, audio.sample_rate).with_provenance(self.profile.model_id),
            "percussive": AudioTensor(perc, audio.sample_rate).with_provenance(
                self.profile.model_id
            ),
        }

    def unload(self) -> None:
        return None


class DrumKitSeparator:
    """Drum-kit decomposition (roadmap §5.5 "drums deep-dive" DSP floor).

    Coarse band+transient split into kick/snare/toms/hh + an ``other``
    remainder. A real drumsep model (``mdx23c-drumsep``) supersedes this when
    installed; this exists purely so ``drums`` / ``drums-deep-dive`` presets
    never hard-fail on a machine with no neural models downloaded.
    """

    def __init__(self, model_id: str = "dsp-drumkit", **_: object) -> None:
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=("kick", "snare", "toms", "hh", "other"),
            fp32_gb=0.05,
            sample_rate=44100,
            quality_class="draft",
            license_spdx="MIT",
            extras={
                "method": "band+transient heuristic",
                "note": "coarse DSP floor; a real drumsep model supersedes this",
            },
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        pieces = drum_kit_split(audio.samples, audio.sample_rate)
        return {
            name: AudioTensor(arr, audio.sample_rate).with_provenance(self.profile.model_id)
            for name, arr in pieces.items()
        }

    def unload(self) -> None:
        return None
