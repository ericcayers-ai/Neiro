"""Aggregate the synthetic golden corpus into one JSON-able report.

This is the shared implementation behind ``scripts/eval/run_synthetic.py`` and
the always-on CI test (``tests/test_eval_harness.py``) — one code path so the
CLI report and the CI assertions can never silently drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from neiro.dsp.bleed import suppress_bleed
from neiro.dsp.pitch import transcribe_mono
from neiro.dsp.separation import center_extract
from neiro.eval import corpus, metrics

__all__ = [
    "SEPARATION_SDR_THRESHOLD_DB",
    "TRANSCRIPTION_F1_THRESHOLD",
    "BLEED_IMPROVEMENT_THRESHOLD_DB",
    "SuiteReport",
    "run_separation_suite",
    "run_bleed_suite",
    "run_transcription_suite",
    "run_synthetic_suite",
]

# Thresholds are deliberately loose: this corpus exists to catch *regressions*
# and *crashes* in the pipeline (roadmap §12's honesty requirement — "the
# displayed quality is a measurement, not marketing"), not to chase a specific
# number on toy signals. Tightening these should come with evidence a change
# actually improved measured quality, not just adjusting until CI is green.
SEPARATION_SDR_THRESHOLD_DB = 3.0
TRANSCRIPTION_F1_THRESHOLD = 0.6
BLEED_IMPROVEMENT_THRESHOLD_DB = 1.0


@dataclass
class SuiteReport:
    """One suite's (separation / bleed / transcription) results plus pass/fail."""

    name: str
    cases: list[dict[str, Any]] = field(default_factory=list)
    passed: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "cases": self.cases}


def run_separation_suite(cases: list[corpus.SeparationCase] | None = None) -> SuiteReport:
    """DSP-floor centre-extraction separation, scored against exact ground truth."""
    cases = cases if cases is not None else corpus.separation_cases()
    report = SuiteReport(name="separation")
    for case in cases:
        centre, sides = center_extract(case.mixture, case.sample_rate)
        vocals_ref = case.sources["vocals"]
        instrumental_ref = case.sources["instrumental"]
        sdr_v = metrics.sdr(centre, vocals_ref)
        si_sdr_v = metrics.si_sdr(centre, vocals_ref)
        resid = metrics.residual_loudness(case.mixture, [centre, sides])
        bleed = metrics.bleed_db(centre, [instrumental_ref])
        ok = sdr_v >= SEPARATION_SDR_THRESHOLD_DB
        report.passed = report.passed and ok
        report.cases.append(
            {
                "case": case.name,
                "description": case.description,
                "sdr_db": round(sdr_v, 2),
                "si_sdr_db": round(si_sdr_v, 2),
                "bleed_db": round(bleed, 2),
                "residual": resid.as_dict(),
                "passed": ok,
                "threshold_sdr_db": SEPARATION_SDR_THRESHOLD_DB,
            }
        )
    return report


def run_bleed_suite(cases: list[corpus.BleedCase] | None = None) -> SuiteReport:
    """Bleed-suppression should measurably reduce the bleed metric it's scored by."""
    cases = cases if cases is not None else corpus.bleed_cases()
    report = SuiteReport(name="bleed_suppression")
    for case in cases:
        before = metrics.bleed_db(case.polluted_target, [case.rival])
        suppressed = suppress_bleed(case.polluted_target, [case.rival], case.sample_rate, strength=0.8)
        after = metrics.bleed_db(suppressed, [case.rival])
        improvement = before - after
        ok = improvement >= BLEED_IMPROVEMENT_THRESHOLD_DB
        report.passed = report.passed and ok
        report.cases.append(
            {
                "case": case.name,
                "description": case.description,
                "bleed_before_db": round(before, 2),
                "bleed_after_db": round(after, 2),
                "improvement_db": round(improvement, 2),
                "passed": ok,
                "threshold_improvement_db": BLEED_IMPROVEMENT_THRESHOLD_DB,
            }
        )
    return report


def run_transcription_suite(cases: list[corpus.TranscriptionCase] | None = None) -> SuiteReport:
    """DSP-floor YIN transcription, scored with mir_eval-style note F1."""
    cases = cases if cases is not None else corpus.transcription_cases()
    report = SuiteReport(name="transcription")
    for case in cases:
        stream = transcribe_mono(case.audio, case.sample_rate)
        result = metrics.note_f1(list(stream.events), list(case.notes))
        ok = result.f1 >= TRANSCRIPTION_F1_THRESHOLD
        report.passed = report.passed and ok
        report.cases.append(
            {
                "case": case.name,
                "description": case.description,
                "notes_predicted": len(stream.events),
                "notes_reference": len(case.notes),
                **result.as_dict(),
                "passed": ok,
                "threshold_f1": TRANSCRIPTION_F1_THRESHOLD,
            }
        )
    return report


def run_synthetic_suite() -> dict[str, Any]:
    """Run every synthetic suite and return one JSON-able report dict."""
    suites = [run_separation_suite(), run_bleed_suite(), run_transcription_suite()]
    return {
        "suites": [s.as_dict() for s in suites],
        "passed": all(s.passed for s in suites),
    }
