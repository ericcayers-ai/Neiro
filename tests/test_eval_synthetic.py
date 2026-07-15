"""Synthetic evaluation harness (always-on CI goldens).

Full MUSDB18 / MAESTRO runs require user-provisioned datasets via
NEIRO_EVAL_MUSDB / NEIRO_EVAL_MAESTRO. Those are optional for local CI;
synthetic mixtures below always run.
"""

from __future__ import annotations

import math

import numpy as np

from neiro.dsp.separation import center_extract


def _si_sdr(est: np.ndarray, ref: np.ndarray) -> float:
    est = est.astype(np.float64).ravel()
    ref = ref.astype(np.float64).ravel()
    n = min(est.size, ref.size)
    est, ref = est[:n], ref[:n]
    alpha = np.dot(est, ref) / (np.dot(ref, ref) + 1e-12)
    target = alpha * ref
    noise = est - target
    return float(10 * np.log10((np.dot(target, target) + 1e-12) / (np.dot(noise, noise) + 1e-12)))


def _tone(freq, seconds=1.0, sr=16000, amp=0.3):
    t = np.arange(int(seconds * sr)) / sr
    return (amp * np.sin(2 * math.pi * freq * t)).astype(np.float32)


def test_synthetic_center_extract_si_sdr():
    sr = 16000
    vocal = _tone(220, sr=sr)
    side = _tone(660, sr=sr, amp=0.2)
    left = vocal + side
    right = vocal - side * 0.5
    mix = np.stack([left, right])
    centre, _sides = center_extract(mix, sr)
    est = centre.mean(axis=0)
    score = _si_sdr(est, vocal)
    assert score > 0.0  # some positive separation on synthetic mid content


def test_note_f1_local():
    """Local mir_eval-style note F1 without external deps."""

    def f1(pred, ref, tol=0.05):
        matched = 0
        used = set()
        for p in pred:
            for i, r in enumerate(ref):
                if i in used:
                    continue
                if abs(p[0] - r[0]) <= tol and p[1] == r[1]:
                    matched += 1
                    used.add(i)
                    break
        prec = matched / max(1, len(pred))
        rec = matched / max(1, len(ref))
        return 0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)

    ref = [(0.0, 60), (0.5, 64), (1.0, 67)]
    pred = [(0.01, 60), (0.52, 64), (1.4, 72)]
    score = f1(pred, ref)
    assert 0.5 <= score <= 1.0
