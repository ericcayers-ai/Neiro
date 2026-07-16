"""Optional Whisper-backed lyrics decoder (roadmap §8.2 "lyrics -> synced meta events").

Uses `openai-whisper <https://github.com/openai/whisper>`_'s word-level
timestamps as a forced-alignment *stub*: real CTC/MFA (Montreal Forced
Aligner) alignment needs the lyric text in advance and a phoneme-level
acoustic model neither of which this floor has, so Whisper's own decode
timestamps stand in for alignment — honestly labeled as such in the profile
extras. When Whisper isn't installed, :meth:`transcribe_lyrics` returns an
*empty* :class:`LyricStream` with a clear note rather than fabricating text,
per the "honest software" principle.
"""

from __future__ import annotations

from neiro.engine.artifacts import AudioTensor, LyricEvent, LyricStream
from neiro.nodes.base import ModelProfile

__all__ = ["WhisperLyricsAdapter"]


class WhisperLyricsAdapter:
    def __init__(
        self,
        model_id: str = "whisper-lyrics",
        whisper_model: str = "base",
        language: str | None = None,
        granularity: str = "segment",  # "segment" or "word"
        reference_text: str | None = None,
        **_: object,
    ) -> None:
        self.whisper_model_name = whisper_model
        self.language = language
        self.granularity = granularity
        self.reference_text = reference_text
        self._model = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe-lyrics",
            fp32_gb=1.0,
            sample_rate=16000,
            channels=1,
            quality_class="standard",
            license_spdx="MIT",
            extras={
                "backend": "openai-whisper",
                "alignment": (
                    "reference-text greedy aligner when reference_text is set; "
                    "else Whisper decode timestamps (not MFA phoneme AM)"
                ),
                "granularity": granularity,
            },
        )

    def load(self, device: str, precision: str) -> None:
        import whisper  # type: ignore

        self._model = whisper.load_model(self.whisper_model_name, device=device)

    def unload(self) -> None:
        self._model = None

    def transcribe_lyrics(self, audio: AudioTensor) -> LyricStream:
        """Decode synced lyric lines/words. Empty + noted if Whisper is unavailable."""
        try:
            import whisper  # noqa: F401
        except ImportError:
            # Honest empty result, not fabricated text — the note lives in
            # `source` so exporters (LRC) can surface *why* it's empty.
            return LyricStream((), source="whisper-lyrics:unavailable (pip install openai-whisper)")

        import tempfile
        from pathlib import Path

        import soundfile as sf

        if self._model is None:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            result = self._model.transcribe(
                str(wav), language=self.language, word_timestamps=(self.granularity == "word")
            )

        events: list[LyricEvent] = []
        timed_words: list[tuple[str, float, float]] = []
        for seg in result.get("segments", []):
            avg_logprob = float(seg.get("avg_logprob", -1.0))
            # Whisper reports avg log-probability, not a [0,1] confidence;
            # a bounded logistic squashes it into a usable, honestly-labeled proxy.
            confidence = float(1.0 / (1.0 + 2.718281828 ** (-(avg_logprob + 0.5) * 4)))
            if self.granularity == "word" and seg.get("words"):
                for w in seg["words"]:
                    text = str(w.get("word", "")).strip()
                    start = float(w["start"])
                    end = float(w["end"])
                    timed_words.append((text, start, end))
                    events.append(
                        LyricEvent(
                            start=start,
                            end=end,
                            text=text,
                            confidence=confidence,
                            provenance=self.profile.model_id,
                        )
                    )
            else:
                events.append(
                    LyricEvent(
                        start=float(seg["start"]),
                        end=float(seg["end"]),
                        text=str(seg.get("text", "")).strip(),
                        confidence=confidence,
                        provenance=self.profile.model_id,
                    )
                )
        if self.reference_text and timed_words:
            from neiro.symbolic.lyric_align import align_reference_lyrics

            aligned = align_reference_lyrics(self.reference_text, timed_words)
            events = [
                LyricEvent(
                    start=a.onset,
                    end=a.offset,
                    text=a.text,
                    confidence=1.0 if a.matched else 0.5,
                    provenance=f"{self.profile.model_id}+ref-align",
                )
                for a in aligned
            ]
            return LyricStream(tuple(events), source=f"{self.profile.model_id}+ref-align")
        return LyricStream(tuple(events), source=self.profile.model_id)
