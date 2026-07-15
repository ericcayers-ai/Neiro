"""Always-on CI tests for :mod:`neiro.eval` — the shared library behind
``scripts/eval/run_synthetic.py``.

The older, lighter ``tests/test_eval_synthetic.py`` still exists as a
smoke-check for the DSP floor; this module asserts the full suite report
(separation SDR + bleed improvement + transcription F1) passes its
documented thresholds. They share the same code path, so the CLI report and
CI assertions cannot silently drift apart.
"""

from __future__ import annotations

import numpy as np

from neiro.eval import corpus, metrics
from neiro.eval.datasets import locate_maestro, locate_musdb
from neiro.eval.report import (
    BLEED_IMPROVEMENT_THRESHOLD_DB,
    SEPARATION_SDR_THRESHOLD_DB,
    TRANSCRIPTION_F1_THRESHOLD,
    run_synthetic_suite,
)


def test_synthetic_suite_passes():
    report = run_synthetic_suite()
    assert report["passed"], report
    names = {s["name"] for s in report["suites"]}
    assert names == {"separation", "bleed_suppression", "transcription"}


def test_metrics_sdr_perfect_match():
    x = np.random.randn(2, 2048).astype(np.float32)
    assert metrics.sdr(x, x) > 100.0
    assert metrics.si_sdr(x, x) > 100.0


def test_metrics_si_sdr_scale_invariant():
    rng = np.random.default_rng(0)
    ref = rng.standard_normal(4096).astype(np.float32)
    est = (ref * 3.5).astype(np.float32)
    # SI-SDR ignores global gain; plain SDR does not.
    assert metrics.si_sdr(est, ref) > 50.0
    assert metrics.sdr(est, ref) < metrics.si_sdr(est, ref)


def test_note_f1_local_backend():
    from neiro.engine.artifacts import NoteEvent

    ref = [NoteEvent(0.0, 0.4, 60), NoteEvent(0.5, 0.9, 64), NoteEvent(1.0, 1.4, 67)]
    pred = [NoteEvent(0.01, 0.4, 60), NoteEvent(0.52, 0.9, 64), NoteEvent(1.4, 1.8, 72)]
    result = metrics.note_f1(pred, ref, prefer_mir_eval=False)
    assert result.backend == "local"
    assert 0.5 <= result.f1 <= 1.0


def test_thresholds_documented():
    # Sanity that the documented thresholds match what the report module exports
    # — so docs/evaluation.md can cite them without hardcoding magic numbers twice.
    assert SEPARATION_SDR_THRESHOLD_DB == 3.0
    assert TRANSCRIPTION_F1_THRESHOLD == 0.6
    assert BLEED_IMPROVEMENT_THRESHOLD_DB == 1.0


def test_corpus_ground_truth_sums():
    for case in corpus.separation_cases():
        recon = sum(case.sources.values())
        assert np.allclose(case.mixture, recon, atol=1e-6)


def test_corpus_has_thirty_plus_golden_cases():
    # R-0118: CI golden stand-in is a fixed closed-form set of ≥30 cases.
    assert corpus.golden_case_count() >= 30


def test_external_datasets_skip_when_unset(monkeypatch):
    monkeypatch.delenv("NEIRO_EVAL_MUSDB", raising=False)
    monkeypatch.delenv("NEIRO_EVAL_MAESTRO", raising=False)
    monkeypatch.delenv("NEIRO_EVAL_MOISES", raising=False)
    musdb = locate_musdb()
    maestro = locate_maestro()
    assert not musdb.available
    assert not maestro.available
    assert "NEIRO_EVAL_MUSDB" in musdb.message
    assert "NEIRO_EVAL_MAESTRO" in maestro.message
    assert "docs/evaluation.md" in musdb.message
