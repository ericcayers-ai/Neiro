"""Multi-instrument (YourMT3 / MIROS-class) whole-mix decoder, with a Basic
Pitch fallback (roadmap §7.2 "full-mix decoder, which hears context").

No YourMT3/MIROS pip package is currently installable in a maintained,
inference-ready form (see roadmap §15 references) — this adapter is
consequently a *real, wired* integration point rather than a promise: it
tries `omnizart <https://pypi.org/project/omnizart/>`_'s multi-instrument
model (``omnizart.music.app.MusicTranscription``, ``model_path="Stream"``,
trained on MusicNet's 11 instrument classes) first, since it is an actual
pip-installable multi-instrument transcriber. If that import or its
checkpoints aren't available, it falls back to
:class:`~neiro.adapters.basic_pitch_adapter.BasicPitchTranscriber` — still a
genuine polyphonic, instrument-agnostic full-mix decode, just without
per-instrument channel separation. Either way the profile's ``extras``
records which backend actually ran, so provenance is never misleading about
what produced the notes.
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
            from omnizart.music.app import MusicTranscription  # type: ignore

            self._omnizart_app = MusicTranscription()
            self._backend = "omnizart"
        except ImportError:
            try:
                from neiro.adapters.basic_pitch_adapter import BasicPitchTranscriber

                self._fallback = BasicPitchTranscriber(track=self.track)
                self._fallback.load(device, precision)
                self._backend = "basic-pitch"
            except ImportError:
                # Neither optional backend is installed — degrade to the
                # dependency-free DSP floor so this decoder never raises just
                # because it was picked automatically (roadmap §7.2's promise
                # that the app keeps running on whatever backends *are*
                # available).
                from neiro.adapters.dsp_transcriber import YinTranscriber

                self._fallback = YinTranscriber(track=self.track)
                self._fallback.load(device, precision)
                self._backend = "dsp-yin"
        self.profile.extras["backend_used"] = self._backend

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        if self._backend is None:
            self.load("cpu", "fp32")

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
                except Exception as exc:
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
