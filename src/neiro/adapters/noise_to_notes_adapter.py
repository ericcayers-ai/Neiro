"""Optional Noise-to-Notes diffusion drum decoder (roadmap §7.1).

Research model (arXiv 2509.21739). When a package exposing
``noise_to_notes.inference.transcribe`` is installed this adapter uses it;
otherwise the router falls back to ``drums-neural`` / ``drums-dsp``.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["NoiseToNotesTranscriber"]

_INSTALL_HINT = (
    "Noise-to-Notes is not installed. Neiro does not bundle N2N weights "
    "(research release, arXiv 2509.21739). Install a package exposing "
    "`noise_to_notes.inference.transcribe` and verify its license. Until then, "
    "drum transcription uses drums-neural (omnizart) or drums-dsp."
)


class NoiseToNotesTranscriber:
    def __init__(
        self,
        model_id: str = "noise-to-notes",
        track: str = "drums",
        checkpoint_path: str | None = None,
        seed: int = 0,
        **_: object,
    ) -> None:
        self.track = track
        self.checkpoint_path = checkpoint_path
        self.seed = seed
        self._ready = False
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=2.0,
            sample_rate=44100,
            channels=1,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "polyphony": "drums / percussion velocity-aware",
                "backend": "noise_to_notes",
                "deterministic_seed": seed,
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            import noise_to_notes  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(f"{self.profile.model_id}: {_INSTALL_HINT}") from exc
        self._ready = True

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        import soundfile as sf
        from noise_to_notes.inference import transcribe as n2n_transcribe  # type: ignore

        if not self._ready:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            raw = n2n_transcribe(str(wav), checkpoint=self.checkpoint_path, seed=self.seed)
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
        return NoteStream(
            tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
        )

    def unload(self) -> None:
        self._ready = False
