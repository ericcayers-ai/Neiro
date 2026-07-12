"""Model-free transcriber adapter: YIN + note segmentation.

Monophonic and labeled as such — the honest floor. Polyphonic neural decoders
(Basic Pitch, Transkun, …) register through the same protocol and win the
router's selection when installed.
"""

from __future__ import annotations

from neiro.dsp.pitch import transcribe_mono
from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["YinTranscriber"]


class YinTranscriber:
    def __init__(
        self,
        model_id: str = "dsp-yin",
        fmin: float = 60.0,
        fmax: float = 1200.0,
        track: str = "melody",
        **_: object,
    ):
        self.fmin = float(fmin)
        self.fmax = float(fmax)
        self.track = track
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=0.05,
            sample_rate=16000,
            channels=1,
            quality_class="draft",
            license_spdx="MIT",
            extras={
                "polyphony": "monophonic",
                "method": "YIN + CMNDF + note segmentation",
            },
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        return transcribe_mono(
            audio.samples,
            audio.sample_rate,
            fmin=self.fmin,
            fmax=self.fmax,
            track=self.track,
        )

    def unload(self) -> None:
        return None
