"""Adapter for ``piano_transcription_inference`` (Kong/ByteDance piano transcription).

The upstream package's own checkpoint fetch shells out to ``wget`` (see its
``PianoTranscription.__init__``), which is not present on Windows by default —
its "auto-download" silently fails there. Neiro's manifest instead declares the
checkpoint as an ``http`` weight (the exact Zenodo URL the package itself would
have fetched) with ``cache_param: checkpoint_path``; the registry resolves that
to a concrete path via :mod:`neiro.engine.registry`, and
:class:`~neiro.engine.registry.ModelEntry.ensure_downloaded` fetches it with
Neiro's own resumable downloader before this adapter ever runs. By the time
``PianoTranscription(checkpoint_path=...)`` executes, the file already exists at
full size, so the package's own exists-and-size-check skips its broken
``wget`` call entirely — the workaround lives in the manifest + registry, not
in a patch to the upstream library.

License: the upstream repository ships no LICENSE file (verified directly,
2026-07) — treated as all-rights-reserved by default copyright law. Flagged as
such in the manifest rather than assumed permissive.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["PianoTranscriptionAdapter"]


class PianoTranscriptionAdapter:
    def __init__(
        self,
        model_id: str = "piano-transcription",
        checkpoint_path: str | None = None,
        track: str = "piano",
        **_: object,
    ) -> None:
        self.checkpoint_path = checkpoint_path
        self.track = track
        self._transcriptor = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=0.7,
            sample_rate=16000,
            channels=1,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "polyphony": "polyphonic (piano-specific)",
                "backend": "piano_transcription_inference",
                "includes_pedal": True,
                "license_note": "upstream repo has no LICENSE file — verify before any commercial use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        from piano_transcription_inference import PianoTranscription

        self._transcriptor = PianoTranscription(
            device="cuda" if device == "cuda" else "cpu",
            checkpoint_path=self.checkpoint_path,
        )

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        if self._transcriptor is None:
            self.load("cpu", "fp32")
        mono = audio.to_mono().samples[0]
        with tempfile.TemporaryDirectory() as tmp:
            midi_path = str(Path(tmp) / "out.mid")
            result = self._transcriptor.transcribe(mono, midi_path)

        events = tuple(
            NoteEvent(
                onset=float(e["onset_time"]),
                offset=float(e["offset_time"]),
                pitch=int(e["midi_note"]),
                velocity=int(max(1, min(127, e["velocity"]))),
                confidence=1.0,  # upstream doesn't expose a per-note confidence
                track=self.track,
            )
            for e in result["est_note_events"]
        )
        return NoteStream(
            tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
        )

    def unload(self) -> None:
        self._transcriptor = None
