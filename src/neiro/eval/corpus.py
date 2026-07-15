"""Synthetic golden corpus (roadmap §12 "golden files", scoped to CI-speed).

The roadmap's ~30-recording golden corpus (real songs, frozen expected outputs)
is explicitly **not** what lives here or in version control — it's large,
real-world audio that would bloat the repository and can't be freely
redistributed. What *does* live here is small, synthesized, exactly-known
audio: every case is generated from closed-form signals (sine tones, silence,
known panning) so the "ground truth" is definitionally correct rather than a
frozen prior run, and every case renders in milliseconds — this corpus is
designed to run on every CI job, every time, with zero external data.

For the real thing — MUSDB18-HQ, MAESTRO — see :mod:`neiro.eval.datasets` and
``docs/evaluation.md``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from neiro.engine.artifacts import NoteEvent

__all__ = [
    "SeparationCase",
    "BleedCase",
    "TranscriptionCase",
    "separation_cases",
    "bleed_cases",
    "transcription_cases",
    "golden_case_count",
]


def _sine(freq: float, seconds: float, sr: int, amp: float = 0.3, phase: float = 0.0) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (amp * np.sin(2 * math.pi * freq * t + phase)).astype(np.float32)


def _silence(seconds: float, sr: int) -> np.ndarray:
    return np.zeros(int(seconds * sr), dtype=np.float32)


@dataclass
class SeparationCase:
    """A stereo mixture plus its exact-known source signals.

    ``mixture`` and every array in ``sources`` share shape ``(channels, frames)``
    at ``sample_rate`` and satisfy ``mixture == sum(sources.values())`` exactly
    (float32 rounding aside) — so the residual/null-test diagnostic on the
    *ground truth* decomposition is a sanity check on the corpus itself, not
    just on whatever separator is under test.
    """

    name: str
    sample_rate: int
    mixture: np.ndarray
    sources: dict[str, np.ndarray]
    description: str = ""


@dataclass
class BleedCase:
    """A target signal polluted by a rival's energy, for bleed-metric evaluation."""

    name: str
    sample_rate: int
    clean_target: np.ndarray
    rival: np.ndarray
    polluted_target: np.ndarray
    pollution_ratio: float
    description: str = ""


@dataclass
class TranscriptionCase:
    """A monophonic audio rendering of an exactly-known note sequence."""

    name: str
    sample_rate: int
    audio: np.ndarray  # (1, frames)
    notes: tuple[NoteEvent, ...]
    description: str = ""
    extra: dict = field(default_factory=dict)


def _melody(
    pitches: list[int],
    *,
    sr: int,
    note_len: float,
    gap: float,
    amp: float = 0.5,
    name: str,
    description: str,
) -> TranscriptionCase:
    chunks: list[np.ndarray] = []
    events: list[NoteEvent] = []
    t = 0.0
    for pitch in pitches:
        freq = 440.0 * 2 ** ((pitch - 69) / 12.0)
        tone = _sine(freq, note_len, sr, amp=amp)
        chunks.append(tone)
        events.append(NoteEvent(onset=round(t, 4), offset=round(t + note_len, 4), pitch=pitch))
        t += note_len
        chunks.append(_silence(gap, sr))
        t += gap
    audio = np.concatenate(chunks)[np.newaxis, :]
    return TranscriptionCase(
        name=name,
        sample_rate=sr,
        audio=audio,
        notes=tuple(events),
        description=description,
    )


def separation_cases(sr: int = 22050) -> list[SeparationCase]:
    """~12 exactly-decomposable stereo mixtures covering pan / density variants."""
    seconds = 1.2
    cases: list[SeparationCase] = []

    def add(name: str, vocals: np.ndarray, instrumental: np.ndarray, description: str) -> None:
        cases.append(
            SeparationCase(
                name=name,
                sample_rate=sr,
                mixture=vocals + instrumental,
                sources={"vocals": vocals, "instrumental": instrumental},
                description=description,
            )
        )

    for i, (vf, gf) in enumerate([(220.0, 660.0), (330.0, 880.0), (110.0, 440.0)]):
        v = _sine(vf, seconds, sr, amp=0.4)
        g = _sine(gf, seconds, sr, amp=0.3)
        add(
            f"centred_hard_left_{i}",
            np.stack([v, v]),
            np.stack([g, np.zeros_like(g)]),
            "Centre tone vs hard-left tone.",
        )
        add(
            f"wide_partial_pan_{i}",
            np.stack([v, v * 0.85]),
            np.stack([g * 0.2, g]),
            "Partial panning on both sources.",
        )
        add(
            f"dense_bed_{i}",
            np.stack([v, v]),
            np.stack([g * 0.5 + _sine(gf * 1.5, seconds, sr, amp=0.15), g * 0.4]),
            "Dense residual-like bed under vocals.",
        )
        # Degraded / quiet solo-like bed
        quiet = _sine(vf * 2, seconds, sr, amp=0.08)
        add(
            f"quiet_wide_bed_{i}",
            np.stack([v * 0.9, v * 0.9]),
            np.stack([quiet, quiet * 0.7]),
            "Quiet wide bed — low energy residual case.",
        )
    return cases


def bleed_cases(sr: int = 16000) -> list[BleedCase]:
    """Target/rival pairs at several pollution strengths and rival frequencies."""
    seconds = 1.0
    cases: list[BleedCase] = []
    for rival_hz in (880.0, 1320.0, 1760.0):
        target = np.stack([_sine(220.0, seconds, sr, amp=0.5)] * 2)
        rival = np.stack([_sine(rival_hz, seconds, sr, amp=0.5)] * 2)
        for ratio in (0.15, 0.4, 0.8):
            cases.append(
                BleedCase(
                    name=f"pollution_{int(rival_hz)}hz_{int(ratio * 100)}pct",
                    sample_rate=sr,
                    clean_target=target,
                    rival=rival,
                    polluted_target=target + ratio * rival,
                    pollution_ratio=ratio,
                    description=f"Target polluted with {ratio:.0%} of a {rival_hz:.0f} Hz rival.",
                )
            )
    return cases


def transcription_cases(sr: int = 22050) -> list[TranscriptionCase]:
    """Monophonic melodies spanning tempo, interval, and rubato-like spacing."""
    cases = [
        _melody(
            [60, 64, 67, 72],
            sr=sr,
            note_len=0.35,
            gap=0.08,
            name="ascending_triad_c_major",
            description="C4-E4-G4-C5, clean sine tones.",
        ),
        _melody(
            [69, 71, 72, 74, 76],
            sr=sr,
            note_len=0.18,
            gap=0.04,
            name="fast_scale_run",
            description="A4-E5 scale fragment at a brisker tempo.",
        ),
        _melody(
            [48, 50, 52, 53, 55],
            sr=sr,
            note_len=0.28,
            gap=0.06,
            name="low_register_run",
            description="Lower-register monophonic line.",
        ),
        _melody(
            [72, 71, 69, 67, 65],
            sr=sr,
            note_len=0.22,
            gap=0.05,
            name="descending_line",
            description="Descending mid-register line.",
        ),
        _melody(
            [60, 62, 64, 65, 67, 69, 71, 72],
            sr=sr,
            note_len=0.15,
            gap=0.03,
            name="full_octave_c_major",
            description="Full C-major scale up.",
        ),
        _melody(
            [60, 63, 67, 70],
            sr=sr,
            note_len=0.32,
            gap=0.1,
            name="odd_meter_gaps",
            description="Larger gaps approximating irregular meter.",
        ),
        _melody(
            [64, 64, 67, 67, 69, 69, 67],
            sr=sr,
            note_len=0.2,
            gap=0.05,
            name="repeated_pitch_pairs",
            description="Repeated pitches for onset resolution stress.",
        ),
        _melody(
            [55, 59, 62, 67, 71],
            sr=sr,
            note_len=0.4,
            gap=0.15,
            name="rubato_wide_gaps",
            description="Wide gaps approximating rubato spacing.",
        ),
        _melody(
            [76, 74, 72, 71, 69, 67],
            sr=sr,
            note_len=0.16,
            gap=0.04,
            name="high_register_descent",
            description="High register descending phrase.",
        ),
    ]
    return cases


def golden_case_count(sr: int = 22050) -> int:
    """Total synthetic golden cases (~30+) used as the CI stand-in for R-0118."""
    return len(separation_cases(sr)) + len(bleed_cases(sr)) + len(transcription_cases(sr))
