"""Evaluation harness (roadmap §12 / Phase 10 — Quality, Evaluation & Testing).

This package is the library half of the evaluation story: metrics
(:mod:`neiro.eval.metrics`), a synthetic golden corpus that always runs with no
external data (:mod:`neiro.eval.corpus`), and locators for the large,
user-provisioned reference datasets (:mod:`neiro.eval.datasets`) that full
MUSDB18-HQ / MAESTRO runs need. See ``docs/evaluation.md`` for the full picture,
including how this relates to the fault-injection tests in
``tests/test_robustness.py`` and the always-on CI goldens in
``tests/test_eval_synthetic.py``.

Thin CLI runners over this library live in ``scripts/eval/`` — this package has
no argparse/CLI code of its own so it stays trivially importable from tests.
"""

from __future__ import annotations

from neiro.eval.metrics import (
    bleed_db,
    midi_to_hz,
    note_f1,
    perceptual_distance,
    residual_loudness,
    sdr,
    si_sdr,
)

__all__ = [
    "sdr",
    "si_sdr",
    "bleed_db",
    "residual_loudness",
    "note_f1",
    "midi_to_hz",
    "perceptual_distance",
]
