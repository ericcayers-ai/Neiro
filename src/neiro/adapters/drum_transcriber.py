"""Drum transcription: a dependency-free DSP floor plus an optional neural
backend (roadmap §7.1 "drum-kit decomposition" / §7.2).

:class:`DrumDspTranscriber` is real signal processing, not a stub: spectral-flux
onset detection (:func:`neiro.dsp.pitch.spectral_flux_onsets`) followed by a
per-hit band-energy classifier that buckets each onset into kick / snare /
hihat / cymbal / tom and maps it to the General MIDI percussion note numbers
(channel 10). It has no dependency and no weights, so it is always available
— honestly labeled ``draft`` quality, the same pattern as the melody YIN
floor.

:class:`DrumNeuralTranscriber` wraps `omnizart <https://pypi.org/project/omnizart/>`_'s
pretrained drum model (``omnizart.drum.app.DrumTranscription``) when the
optional dependency (and its separately-downloaded checkpoints — omnizart
manages those itself via ``omnizart download-checkpoints``) are present.
Missing either raises a clear, caught-upstream error rather than silently
producing wrong output — the router/orchestrator fall back to the DSP floor.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.pitch import spectral_flux_onsets
from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream
from neiro.nodes.base import ModelProfile

__all__ = ["DrumDspTranscriber", "DrumNeuralTranscriber", "GM_DRUM_MAP"]

# General MIDI percussion key map (channel 10), the subset this classifier targets.
GM_DRUM_MAP: dict[str, int] = {
    "kick": 36,
    "snare": 38,
    "hihat": 42,
    "open_hihat": 46,
    "tom": 47,
    "cymbal": 49,
}


def _band_energy(spec: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> float:
    mask = (freqs >= lo) & (freqs < hi)
    return float(spec[mask].sum()) if mask.any() else 0.0


def classify_hit(window: np.ndarray, sr: int) -> tuple[str, float]:
    """Classify one drum hit window into a GM drum-map key. Returns ``(name, confidence)``."""
    if window.size < 8 or np.max(np.abs(window)) < 1e-6:
        return "tom", 0.1
    w = window * np.hanning(len(window))
    spec = np.abs(np.fft.rfft(w))
    freqs = np.fft.rfftfreq(len(window), 1.0 / sr)
    low = _band_energy(spec, freqs, 20, 150)
    lowmid = _band_energy(spec, freqs, 150, 400)
    mid = _band_energy(spec, freqs, 400, 2000)
    high = _band_energy(spec, freqs, 2000, 8000)
    veryhigh = _band_energy(spec, freqs, 8000, sr / 2)
    total = low + lowmid + mid + high + veryhigh + 1e-9

    scores = {
        "kick": low / total,
        "snare": 0.6 * (lowmid / total) + 0.4 * (mid / total),
        "hihat": veryhigh / total,
        "cymbal": (high / total) * 0.5 + (veryhigh / total) * 0.5,
        "tom": (lowmid / total) * 0.5 + (mid / total) * 0.3,
    }
    name = max(scores, key=scores.get)
    # Confidence: how dominant the winning class was vs. the runner-up —
    # an honest measure of classification ambiguity, not detection strength.
    ordered = sorted(scores.values(), reverse=True)
    margin = ordered[0] - (ordered[1] if len(ordered) > 1 else 0.0)
    confidence = float(np.clip(0.4 + margin * 1.5, 0.1, 0.95))
    return name, confidence


class DrumDspTranscriber:
    def __init__(self, model_id: str = "drums-dsp", track: str = "drums", **_: object) -> None:
        self.track = track
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=0.05,
            sample_rate=44100,
            channels=1,
            quality_class="draft",
            license_spdx="MIT",
            extras={
                "polyphony": "percussion (onset classification)",
                "method": "spectral-flux onsets + band-energy classifier",
            },
        )

    def load(self, device: str, precision: str) -> None:
        return None

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        mono = audio.to_mono().samples[0].astype(np.float64)
        sr = audio.sample_rate
        onsets = spectral_flux_onsets(mono, sr)
        hit_win = max(16, int(0.03 * sr))
        events: list[NoteEvent] = []
        for i, onset in enumerate(onsets):
            start = int(onset * sr)
            window = mono[start : start + hit_win]
            name, conf = classify_hit(window, sr)
            pitch = GM_DRUM_MAP[name]
            peak = float(np.max(np.abs(window))) if window.size else 0.0
            velocity = int(np.clip(30 + 97 * min(1.0, peak / 0.5), 1, 127))
            next_onset = onsets[i + 1] if i + 1 < len(onsets) else onset + 0.2
            duration = max(0.05, min(0.35, float(next_onset - onset) * 0.8))
            events.append(
                NoteEvent(
                    onset=round(float(onset), 6),
                    offset=round(float(onset) + duration, 6),
                    pitch=pitch,
                    velocity=velocity,
                    confidence=round(conf, 3),
                    track=self.track,
                )
            )
        return NoteStream(tuple(events), source=self.profile.model_id)

    def unload(self) -> None:
        return None


class DrumNeuralTranscriber:
    """Optional omnizart-backed drum decoder; requires the pip package + checkpoints."""

    def __init__(
        self,
        model_id: str = "drums-neural",
        track: str = "drums",
        model_path: str | None = None,
        **_: object,
    ) -> None:
        self.track = track
        self.model_path = model_path
        self._app = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=1.0,
            sample_rate=44100,
            channels=1,
            quality_class="standard",
            license_spdx="MIT",
            extras={
                "polyphony": "percussion (13-class drum activation)",
                "backend": "omnizart.drum.app.DrumTranscription",
                "note": "requires `omnizart download-checkpoints` once, out of band",
            },
        )

    def load(self, device: str, precision: str) -> None:
        from omnizart.drum.app import DrumTranscription  # type: ignore

        self._app = DrumTranscription()

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        import tempfile
        from pathlib import Path

        import soundfile as sf

        if self._app is None:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            try:
                midi = self._app.transcribe(str(wav), model_path=self.model_path, output=tmp)
            except Exception as exc:  # pragma: no cover - depends on external checkpoints
                raise RuntimeError(
                    f"omnizart drum transcription failed ({exc}); run "
                    "'omnizart download-checkpoints' or fall back to drums-dsp"
                ) from exc

        events = tuple(
            NoteEvent(
                onset=round(float(n.start), 6),
                offset=round(float(n.end), 6),
                pitch=int(n.pitch),
                velocity=int(max(1, min(127, round(n.velocity)))),
                confidence=0.8,
                track=self.track,
            )
            for inst in midi.instruments
            for n in inst.notes
        )
        return NoteStream(
            tuple(sorted(events, key=lambda e: e.onset)), source=self.profile.model_id
        )

    def unload(self) -> None:
        self._app = None
