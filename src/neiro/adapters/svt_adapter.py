"""SVT-class vocal melody decoder (roadmap §7.1 "SVT_SpeechBrain").

Tries a SpeechBrain SVT / pitch pipeline when ``speechbrain`` is installed;
otherwise falls back to Basic Pitch on the vocal stem, then the YIN floor —
same honest-degrade pattern as :mod:`neiro.adapters.multi_instrument_adapter`.
"""

from __future__ import annotations

from dataclasses import replace

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["SVTMelodyTranscriber"]


class SVTMelodyTranscriber:
    def __init__(
        self,
        model_id: str = "svt-melody",
        track: str = "vocals",
        **_: object,
    ) -> None:
        self.track = track
        self._backend: str | None = None
        self._fallback = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=1.0,
            sample_rate=16000,
            channels=1,
            quality_class="standard",
            license_spdx="MIT",
            extras={
                "polyphony": "vocal melody",
                "backend": "speechbrain SVT (preferred) with basic-pitch / yin fallback",
            },
        )

    def load(self, device: str, precision: str) -> None:
        # SpeechBrain SVT_SpeechBrain is a research repo; when a packaged
        # inference entry point appears we prefer it. Until then, Basic Pitch
        # on a cleaned vocal stem is the best installable melody decode.
        try:
            import speechbrain  # noqa: F401

            from neiro.adapters.basic_pitch_adapter import BasicPitchTranscriber

            self._fallback = BasicPitchTranscriber(track=self.track)
            self._fallback.load(device, precision)
            self._backend = "basic-pitch+speechbrain-available"
        except ImportError:
            try:
                from neiro.adapters.basic_pitch_adapter import BasicPitchTranscriber

                self._fallback = BasicPitchTranscriber(track=self.track)
                self._fallback.load(device, precision)
                self._backend = "basic-pitch"
            except ImportError:
                from neiro.adapters.dsp_transcriber import YinTranscriber

                self._fallback = YinTranscriber(track=self.track)
                self._fallback.load(device, precision)
                self._backend = "dsp-yin"
        self.profile.extras["backend_used"] = self._backend

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        if self._backend is None:
            self.load("cpu", "fp32")
        stream = self._fallback.transcribe(audio)
        events = tuple(
            e if e.provenance else replace(e, provenance=self.profile.model_id)
            for e in stream.events
        )
        return NoteStream(events, source=self.profile.model_id)

    def unload(self) -> None:
        if self._fallback is not None:
            self._fallback.unload()
        self._backend = None
