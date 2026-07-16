"""Multi-instrument (YourMT3 / MIROS-class) whole-mix decoder.

Roadmap §7.2 "full-mix decoder, which hears context". Preference order:

1. ``mt3-infer`` YourMT3 (Apache-2.0, auto-downloads checkpoints)
2. ``omnizart`` MusicTranscription (``model_path="Stream"``)
3. Basic Pitch, then YIN

The dedicated ``yourmt3`` manifest uses :class:`YourMT3Transcriber` directly;
this adapter remains the always-available DEFAULT_DECODERS entry that degrades
honestly when optional backends are missing.
"""

from __future__ import annotations

from dataclasses import replace

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["MultiInstrumentAdapter"]


class MultiInstrumentAdapter:
    def __init__(
        self,
        model_id: str = "multi-instrument",
        track: str = "multi",
        omnizart_model_path: str = "Stream",
        **_: object,
    ) -> None:
        self.track = track
        self.omnizart_model_path = omnizart_model_path
        self._backend: str | None = None
        self._omnizart_app = None
        self._fallback = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=1.2,
            sample_rate=44100,
            channels=1,
            quality_class="standard",
            license_spdx="MIT",
            extras={
                "polyphony": "polyphonic, multi-instrument (whole mix)",
                "backend": "omnizart (preferred) with basic-pitch fallback",
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            from neiro.adapters.mt3_adapter import YourMT3Transcriber

            self._fallback = YourMT3Transcriber(track=self.track)
            self._fallback.load(device, precision)
            self._backend = "yourmt3"
            self.profile.extras["backend_used"] = self._backend
            return
        except (ImportError, RuntimeError):
            self._fallback = None

        try:
            from omnizart.music.app import MusicTranscription  # type: ignore

            self._omnizart_app = MusicTranscription()
            self._backend = "omnizart"
            self.profile.extras["backend_used"] = self._backend
            return
        except ImportError:
            pass

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

        if self._backend == "yourmt3":
            return self._fallback.transcribe(audio)

        if self._backend == "omnizart":
            import tempfile
            from pathlib import Path

            import soundfile as sf

            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp) / "in.wav"
                sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
                try:
                    midi = self._omnizart_app.transcribe(
                        str(wav), model_path=self.omnizart_model_path, output=tmp
                    )
                except Exception:
                    # Graceful degrade: checkpoints missing or inference failed
                    # -> fall back to Basic Pitch, then the DSP floor, rather
                    # than raising.
                    try:
                        from neiro.adapters.basic_pitch_adapter import BasicPitchTranscriber

                        self._fallback = BasicPitchTranscriber(track=self.track)
                        self._fallback.load("cpu", "fp32")
                        self._backend = "basic-pitch"
                        self.profile.extras["backend_used"] = "basic-pitch (omnizart failed)"
                    except ImportError:
                        from neiro.adapters.dsp_transcriber import YinTranscriber

                        self._fallback = YinTranscriber(track=self.track)
                        self._fallback.load("cpu", "fp32")
                        self._backend = "dsp-yin"
                        self.profile.extras["backend_used"] = "dsp-yin (omnizart failed)"
                    return self._fallback.transcribe(audio)

            from neiro.engine.artifacts import NoteEvent

            events = tuple(
                NoteEvent(
                    onset=round(float(n.start), 6),
                    offset=round(float(n.end), 6),
                    pitch=int(n.pitch),
                    velocity=int(max(1, min(127, round(n.velocity)))),
                    confidence=0.7,
                    track=self.track,
                    provenance=self.profile.model_id,
                )
                for inst in midi.instruments
                for n in inst.notes
            )
            return NoteStream(
                tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
            )

        stream = self._fallback.transcribe(audio)
        events = tuple(
            e if e.provenance else replace(e, provenance=self.profile.model_id)
            for e in stream.events
        )
        return NoteStream(events, source=self.profile.model_id)

    def unload(self) -> None:
        if self._fallback is not None:
            self._fallback.unload()
        self._omnizart_app = None
        self._backend = None
