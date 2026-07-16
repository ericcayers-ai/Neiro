"""YourMT3 / MT3-family multi-instrument transcription via ``mt3-infer``.

Roadmap §7.1: "Full-mix multi-instrument (no split) — MIROS / YourMT3+".
``mt3-infer`` (https://github.com/openmirlab/mt3-infer) is the maintained
inference-only package that vendors YourMT3, MR-MT3, and MT3-PyTorch behind
one ``transcribe()`` / ``load_model()`` API with automatic checkpoint fetch.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["YourMT3Transcriber"]


class YourMT3Transcriber:
    def __init__(
        self,
        model_id: str = "yourmt3",
        model: str = "yourmt3",
        track: str = "multi",
        **_: object,
    ) -> None:
        self.model_name = model
        self.track = track
        self._model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=2.5,
            fp16_gb=1.5,
            supports_fp16=True,
            sample_rate=16000,
            channels=1,
            quality_class="reference",
            license_spdx="Apache-2.0",
            extras={
                "polyphony": "polyphonic, multi-instrument (whole mix)",
                "backend": f"mt3-infer:{model}",
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            from mt3_infer import load_model  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: mt3-infer is not installed. "
                "Install with `pip install mt3-infer` (or `neiro[mt3]`)."
            ) from exc
        try:
            self._model = load_model(self.model_name, device=device)
        except TypeError:
            # Some versions take no device kwarg.
            self._model = load_model(self.model_name)

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        import soundfile as sf

        if self._model is None:
            self.load("cpu", "fp32")

        # Prefer the model's own transcribe method; fall back to module-level API.
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            midi_path = Path(tmp) / "out.mid"
            notes = None
            if hasattr(self._model, "transcribe"):
                try:
                    notes = self._model.transcribe(str(wav))
                except TypeError:
                    notes = self._model.transcribe(str(wav), str(midi_path))
            if notes is None:
                from mt3_infer import transcribe as mt3_transcribe  # type: ignore

                notes = mt3_transcribe(str(wav), model=self.model_name)

        return self._to_note_stream(notes, midi_path if midi_path.is_file() else None)

    def _to_note_stream(self, notes: object, midi_path: object) -> NoteStream:
        from pathlib import Path

        # Path-like MIDI output
        if isinstance(notes, (str, Path)) or (
            hasattr(notes, "exists") and Path(str(notes)).is_file()
        ):
            from neiro.symbolic.midi import read_midi_notes

            stream = read_midi_notes(Path(str(notes)), track=self.track)
            return NoteStream(stream.events, source=self.profile.model_id)

        if midi_path is not None and Path(str(midi_path)).is_file():
            from neiro.symbolic.midi import read_midi_notes

            stream = read_midi_notes(Path(str(midi_path)), track=self.track)
            return NoteStream(stream.events, source=self.profile.model_id)

        # pretty_midi.PrettyMIDI
        if hasattr(notes, "instruments"):
            events = tuple(
                NoteEvent(
                    onset=round(float(n.start), 6),
                    offset=round(float(n.end), 6),
                    pitch=int(n.pitch),
                    velocity=int(max(1, min(127, round(getattr(n, "velocity", 80))))),
                    confidence=0.75,
                    track=self.track,
                    provenance=self.profile.model_id,
                )
                for inst in notes.instruments
                for n in inst.notes
            )
            return NoteStream(
                tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
            )

        # Iterable of note-like dicts / objects
        events_list: list[NoteEvent] = []
        try:
            for n in notes:  # type: ignore[union-attr]
                if isinstance(n, dict):
                    onset = float(n.get("start", n.get("onset", 0.0)))
                    offset = float(n.get("end", n.get("offset", onset + 0.1)))
                    pitch = int(n.get("pitch", n.get("note", 60)))
                    velocity = int(n.get("velocity", 80))
                else:
                    onset = float(getattr(n, "start", getattr(n, "onset", 0.0)))
                    offset = float(getattr(n, "end", getattr(n, "offset", onset + 0.1)))
                    pitch = int(getattr(n, "pitch", getattr(n, "note", 60)))
                    velocity = int(getattr(n, "velocity", 80))
                events_list.append(
                    NoteEvent(
                        onset=round(onset, 6),
                        offset=round(offset, 6),
                        pitch=pitch,
                        velocity=int(max(1, min(127, velocity))),
                        confidence=0.75,
                        track=self.track,
                        provenance=self.profile.model_id,
                    )
                )
        except TypeError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: unrecognized mt3-infer output type {type(notes)!r}"
            ) from exc
        return NoteStream(
            tuple(sorted(events_list, key=lambda e: e.onset)), source=self.profile.model_id
        )

    def unload(self) -> None:
        self._model = None
