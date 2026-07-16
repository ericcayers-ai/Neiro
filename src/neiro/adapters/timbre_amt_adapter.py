"""Optional TimbreAMT guitar/tablature decoder (roadmap §7.1).

TimbreAMT is a research string/fret-aware AMT model
(https://github.com/madderscientist/timbreAMT). When a package exposing
``timbre_amt.inference.transcribe`` is installed this adapter uses it;
otherwise :meth:`load` raises and the router falls back to Basic Pitch
(with Neiro's DP tablature assignment in the symbolic layer).
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["TimbreAMTTranscriber"]

_INSTALL_HINT = (
    "TimbreAMT is not installed. Neiro does not bundle TimbreAMT weights. "
    "Install a package exposing `timbre_amt.inference.transcribe` "
    "(see https://github.com/madderscientist/timbreAMT). Until then, guitar "
    "transcription uses Basic Pitch + Neiro's tablature DP assignment."
)


class TimbreAMTTranscriber:
    def __init__(
        self,
        model_id: str = "timbre-amt",
        track: str = "guitar",
        checkpoint_path: str | None = None,
        **_: object,
    ) -> None:
        self.track = track
        self.checkpoint_path = checkpoint_path
        self._ready = False
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=1.5,
            sample_rate=44100,
            channels=1,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "polyphony": "guitar tablature-aware",
                "backend": "timbre_amt",
                "license_note": "verify upstream TimbreAMT license before commercial use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import timbre_amt  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(f"{self.profile.model_id}: {_INSTALL_HINT}") from exc
        self._ready = True

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        import soundfile as sf
        from timbre_amt.inference import transcribe as amt_transcribe  # type: ignore

        if not self._ready:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            raw = amt_transcribe(str(wav), checkpoint=self.checkpoint_path)
        events = tuple(
            NoteEvent(
                onset=round(float(n["onset"] if isinstance(n, dict) else n.onset), 6),
                offset=round(float(n["offset"] if isinstance(n, dict) else n.offset), 6),
                pitch=int(n["pitch"] if isinstance(n, dict) else n.pitch),
                velocity=int(
                    max(1, min(127, int(n.get("velocity", 80) if isinstance(n, dict) else 80)))
                ),
                confidence=0.7,
                track=self.track,
                provenance=self.profile.model_id,
            )
            for n in raw
        )
        return NoteStream(tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id)

    def unload(self) -> None:
        self._ready = False
