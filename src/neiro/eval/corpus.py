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


def separation_cases(sr: int = 22050) -> list[SeparationCase]:
    """A handful of small, exactly-decomposable stereo mixtures.

    Cases deliberately vary panning geometry so a separator that only handles
    one configuration (e.g. purely centre-panned vocals) is caught: a fully
    centred case, a partially-panned case, and a case with a quiet, wide
    "residual-like" bed on top of the two dominant sources.
    """
    seconds = 1.5
    cases: list[SeparationCase] = []

    vocal = _sine(220.0, seconds, sr, amp=0.4)
    guitar = _sine(660.0, seconds, sr, amp=0.3)
    vocal_centre = np.stack([vocal, vocal])
    guitar_left = np.stack([guitar, np.zeros_like(guitar)])
    cases.append(
        SeparationCase(
            name="centred_vocal_hard_left_guitar",
            sample_rate=sr,
            mixture=vocal_centre + guitar_left,
            sources={"vocals": vocal_centre, "instrumental": guitar_left},
            description="Fully centre-panned tone vs. a hard-left tone — the easy case.",
        )
    )

    bass = _sine(110.0, seconds, sr, amp=0.35)
    keys = _sine(440.0, seconds, sr, amp=0.25)
    bass_wide = np.stack([bass, bass * 0.85])  # mostly centred, slightly wide
    keys_panned = np.stack([keys * 0.2, keys])  # mostly right
    cases.append(
        SeparationCase(
            name="wide_bass_right_panned_keys",
            sample_rate=sr,
            mixture=bass_wide + keys_panned,
            sources={"vocals": bass_wide, "instrumental": keys_panned},
            description="Partial panning on both sources — harder than a hard pan.",
        )
    )

    return cases


def bleed_cases(sr: int = 16000) -> list[BleedCase]:
    """Target/rival pairs at a few pollution strengths, for :func:`neiro.eval.metrics.bleed_db`."""
    seconds = 1.0
    cases: list[BleedCase] = []
    target = np.stack([_sine(220.0, seconds, sr, amp=0.5)] * 2)
    rival = np.stack([_sine(880.0, seconds, sr, amp=0.5)] * 2)
    for ratio in (0.15, 0.4, 0.8):
        cases.append(
            BleedCase(
                name=f"pollution_{int(ratio * 100)}pct",
                sample_rate=sr,
                clean_target=target,
                rival=rival,
                polluted_target=target + ratio * rival,
                pollution_ratio=ratio,
                description=f"Target polluted with {ratio:.0%} of a disjoint-frequency rival.",
            )
        )
    return cases


def transcription_cases(sr: int = 22050) -> list[TranscriptionCase]:
    """Small monophonic melodies with exactly-known onsets/pitches.

    Notes are rendered as plain sine tones with a short silence gap between
    them so a note segmenter has an unambiguous boundary to find — this
    corpus tests the transcription *pipeline* (pitch tracking + segmentation
    + F1 scoring), not a decoder's robustness to polyphony or noise.
    """
    cases: list[TranscriptionCase] = []

    # A simple ascending triad, evenly spaced, generous durations.
    pitches = [60, 64, 67, 72]  # C4 E4 G4 C5
    note_len, gap = 0.35, 0.08
    chunks: list[np.ndarray] = []
    events: list[NoteEvent] = []
    t = 0.0
    for pitch in pitches:
        freq = 440.0 * 2 ** ((pitch - 69) / 12.0)
        tone = _sine(freq, note_len, sr, amp=0.5)
        chunks.append(tone)
        events.append(NoteEvent(onset=round(t, 4), offset=round(t + note_len, 4), pitch=pitch))
        t += note_len
        chunks.append(_silence(gap, sr))
        t += gap
    audio = np.concatenate(chunks)[np.newaxis, :]
    cases.append(
        TranscriptionCase(
            name="ascending_triad_c_major",
            sample_rate=sr,
            audio=audio,
            notes=tuple(events),
            description="C4-E4-G4-C5, clean sine tones, generous gaps between notes.",
        )
    )

    # A faster, smaller-interval run to stress onset resolution a bit more.
    pitches2 = [69, 71, 72, 74, 76]  # A4 B4 C5 D5 E5
    note_len2, gap2 = 0.18, 0.04
    chunks2: list[np.ndarray] = []
    events2: list[NoteEvent] = []
    t = 0.0
    for pitch in pitches2:
        freq = 440.0 * 2 ** ((pitch - 69) / 12.0)
        tone = _sine(freq, note_len2, sr, amp=0.5)
        chunks2.append(tone)
        events2.append(NoteEvent(onset=round(t, 4), offset=round(t + note_len2, 4), pitch=pitch))
        t += note_len2
        chunks2.append(_silence(gap2, sr))
        t += gap2
    audio2 = np.concatenate(chunks2)[np.newaxis, :]
    cases.append(
        TranscriptionCase(
            name="fast_scale_run",
            sample_rate=sr,
            audio=audio2,
            notes=tuple(events2),
            description="A4-E5 scale fragment at a brisker tempo, shorter notes.",
        )
    )

    return cases
