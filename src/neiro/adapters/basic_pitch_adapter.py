"""Optional Basic Pitch backend (Spotify) — polyphonic, instrument-agnostic.

Usable when ``basic-pitch`` is installed; the manifest's ``requires`` gates
availability so the registry skips it cleanly otherwise. Imports are deferred to
:meth:`load`.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["BasicPitchTranscriber"]


class BasicPitchTranscriber:
    def __init__(self, model_id: str = "basic-pitch", track: str = "notes", **_: object):
        self.track = track
        self._predict = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=0.6,
            sample_rate=22050,
            channels=1,
            quality_class="standard",
            license_spdx="Apache-2.0",
            extras={"polyphony": "polyphonic", "backend": "basic-pitch"},
        )

    def load(self, device: str, precision: str) -> None:
        from basic_pitch.inference import predict  # type: ignore

        self._predict = predict

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        import soundfile as sf

        if self._predict is None:
            self.load("cpu", "fp32")
        # basic-pitch's public API is file-based; hand it a temp WAV.
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            _, _, note_events = self._predict(str(wav))
        events = tuple(
            NoteEvent(
                onset=float(start),
                offset=float(end),
                pitch=int(pitch),
                velocity=int(max(1, min(127, round(amplitude * 127)))),
                confidence=float(min(1.0, amplitude)),
                track=self.track,
            )
            for start, end, pitch, amplitude, _bends in note_events
        )
        return NoteStream(
            tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
        )

    def unload(self) -> None:
        self._predict = None
