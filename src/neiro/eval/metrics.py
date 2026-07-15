"""Evaluation metrics (roadmap §12).

Separation: :func:`sdr` and :func:`si_sdr` are the standard time-domain source
separation metrics; :func:`bleed_db` re-exports
:func:`neiro.dsp.bleed.bleed_estimate_db` (the metric already used by the bleed
*suppression* node — evaluation and processing share one honest definition, not
two) and :func:`residual_loudness` wraps :func:`neiro.dsp.separation.residual`
into the null-test diagnostic the CLI already prints after a separation job.

Transcription: :func:`note_f1` computes mir_eval-style note-level F1 (onset +
pitch match within tolerance) using the real `mir_eval
<https://github.com/craffel/mir_eval>`_ package when it's importable, and a
small dependency-free local implementation otherwise — so the harness always
runs, and gets a citeable, third-party-validated metric for free when
``pip install mir_eval`` is available (it is not a hard dependency of Neiro).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from neiro.dsp.bleed import bleed_estimate_db
from neiro.dsp.separation import residual

__all__ = [
    "sdr",
    "si_sdr",
    "bleed_db",
    "residual_loudness",
    "ResidualLoudness",
    "note_f1",
    "NoteF1Result",
    "midi_to_hz",
]


def _flatten(x: np.ndarray) -> np.ndarray:
    return np.asarray(x, dtype=np.float64).reshape(-1)


def sdr(estimate: np.ndarray, reference: np.ndarray) -> float:
    """Signal-to-Distortion Ratio in dB: ``10*log10(||ref||^2 / ||est-ref||^2)``.

    Not scale- or shift-invariant — a global gain/offset error is penalized,
    unlike :func:`si_sdr`. Both are reported because they answer different
    questions: SDR is closer to "does the output sound like the target,
    including its level", SI-SDR isolates separation quality from a model's
    (often deliberately mismatched) output gain.
    """
    est, ref = _flatten(estimate), _flatten(reference)
    n = min(est.size, ref.size)
    est, ref = est[:n], ref[:n]
    noise = est - ref
    ref_energy = float(np.dot(ref, ref))
    noise_energy = float(np.dot(noise, noise))
    return float(10 * np.log10((ref_energy + 1e-12) / (noise_energy + 1e-12)))


def si_sdr(estimate: np.ndarray, reference: np.ndarray) -> float:
    """Scale-Invariant SDR in dB (Le Roux et al., 2019).

    Projects the estimate onto the reference before measuring the residual, so a
    correctly-shaped-but-differently-scaled estimate scores well.
    """
    est, ref = _flatten(estimate), _flatten(reference)
    n = min(est.size, ref.size)
    est, ref = est[:n], ref[:n]
    alpha = float(np.dot(est, ref) / (np.dot(ref, ref) + 1e-12))
    target = alpha * ref
    noise = est - target
    target_energy = float(np.dot(target, target))
    noise_energy = float(np.dot(noise, noise))
    return float(10 * np.log10((target_energy + 1e-12) / (noise_energy + 1e-12)))


def bleed_db(target: np.ndarray, rivals: list[np.ndarray]) -> float:
    """Rival-stem energy bled into ``target``, in dB. Thin re-export, see module docstring."""
    return bleed_estimate_db(np.asarray(target, dtype=np.float32), rivals)


@dataclass
class ResidualLoudness:
    """The null-test diagnostic (roadmap §5.4): ``source - sum(estimated stems)``."""

    peak_dbfs: float
    rms_dbfs: float

    def as_dict(self) -> dict[str, float]:
        return {"peak_dbfs": round(self.peak_dbfs, 2), "rms_dbfs": round(self.rms_dbfs, 2)}


def residual_loudness(source: np.ndarray, stems: list[np.ndarray]) -> ResidualLoudness:
    """Loudness of ``source - sum(stems)``. Lower (more negative) is better —
    it means the stems fully account for the mix. A loud residual is evidence a
    model dropped or misattributed content, independent of any ground truth.
    """
    resid = residual(np.asarray(source, dtype=np.float32), stems)
    peak = float(np.max(np.abs(resid))) if resid.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(resid)))) if resid.size else 0.0
    return ResidualLoudness(
        peak_dbfs=20.0 * np.log10(peak + 1e-12),
        rms_dbfs=20.0 * np.log10(rms + 1e-12),
    )


def midi_to_hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


class _NoteLike(Protocol):
    onset: float
    offset: float
    pitch: int


@dataclass
class NoteF1Result:
    precision: float
    recall: float
    f1: float
    backend: str  # "mir_eval" or "local"

    def as_dict(self) -> dict[str, Any]:
        return {
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "backend": self.backend,
        }


def _local_note_f1(
    pred: list[_NoteLike], ref: list[_NoteLike], onset_tolerance: float
) -> tuple[float, float, float]:
    """Greedy one-to-one match by onset proximity + exact pitch. No external deps."""
    used: set[int] = set()
    matched = 0
    for p in pred:
        best_i, best_dt = -1, onset_tolerance + 1e-9
        for i, r in enumerate(ref):
            if i in used or r.pitch != p.pitch:
                continue
            dt = abs(p.onset - r.onset)
            if dt <= onset_tolerance and dt < best_dt:
                best_i, best_dt = i, dt
        if best_i >= 0:
            used.add(best_i)
            matched += 1
    precision = matched / len(pred) if pred else (1.0 if not ref else 0.0)
    recall = matched / len(ref) if ref else (1.0 if not pred else 0.0)
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return precision, recall, f1


def note_f1(
    pred: list[_NoteLike],
    ref: list[_NoteLike],
    *,
    onset_tolerance: float = 0.05,
    pitch_tolerance_cents: float = 50.0,
    prefer_mir_eval: bool = True,
) -> NoteF1Result:
    """Note-level onset+pitch F1, mir_eval-compatible when mir_eval is installed.

    ``pred``/``ref`` are sequences of note-like objects (anything with
    ``.onset``, ``.offset``, ``.pitch`` — :class:`neiro.engine.artifacts.NoteEvent`
    satisfies this). Falls back to a dependency-free local matcher — same
    onset-tolerance, exact-pitch-class semantics — when ``mir_eval`` isn't
    importable or either sequence is empty (mir_eval's note-transcription API is
    not well-defined on empty inputs).
    """
    if prefer_mir_eval and pred and ref:
        try:
            import mir_eval.transcription as mt

            ref_intervals = np.array([[r.onset, r.offset] for r in ref], dtype=np.float64)
            ref_pitches = np.array([midi_to_hz(r.pitch) for r in ref], dtype=np.float64)
            est_intervals = np.array([[p.onset, p.offset] for p in pred], dtype=np.float64)
            est_pitches = np.array([midi_to_hz(p.pitch) for p in pred], dtype=np.float64)
            precision, recall, f1, _avg_overlap = mt.precision_recall_f1_overlap(
                ref_intervals,
                ref_pitches,
                est_intervals,
                est_pitches,
                onset_tolerance=onset_tolerance,
                pitch_tolerance=pitch_tolerance_cents,
                offset_ratio=None,
            )
            return NoteF1Result(float(precision), float(recall), float(f1), backend="mir_eval")
        except ImportError:
            pass
    precision, recall, f1 = _local_note_f1(list(pred), list(ref), onset_tolerance)
    return NoteF1Result(precision, recall, f1, backend="local")
