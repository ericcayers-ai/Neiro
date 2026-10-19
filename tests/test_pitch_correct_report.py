"""Regression: pitch-correct job progress must use Progress objects.

The original bug called the progress callback as ``progress("...", fraction=x)``.
That callback takes a single ``Progress`` object, so every pitch-correct job died
with TypeError. These tests pin the contract and the end-to-end job result.
"""

from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

from neiro.engine.graph import Progress
from neiro.ui.server import _run_pitch_correct, _State


def _tone(path, seconds: float = 1.0, sr: int = 22050):
    t = np.arange(int(seconds * sr)) / sr
    signal = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    sf.write(path, signal, sr)
    return path


def test_progress_callback_only_accepts_progress_objects():
    """Documents the failure mode: the callback is not a (str, fraction=) function."""
    seen: list[Progress] = []

    def cb(prog: Progress) -> None:
        seen.append(prog)

    with pytest.raises(TypeError):
        cb("pitch_correct: loading", fraction=0.05)  # type: ignore[call-arg]
    cb(Progress(node_id="pitch_correct", stage="loading", fraction=0.05))
    assert seen[0].fraction == 0.05


def test_pitch_correct_job_reports_progress_and_finishes(tmp_path):
    state = _State()
    file_id = state.register_path(_tone(tmp_path / "tone.wav"))
    with state.lock:
        state.jobs["job"] = {
            "status": "running",
            "kind": "pitch_correct",
            "progress": [],
            "progress_events": [],
            "stage": "queued",
            "fraction": 0.0,
            "eta_s": None,
        }
    _run_pitch_correct(state, "job", file_id, None, 1.0)
    job = state.jobs["job"]
    assert job["status"] == "done", job
    assert job["result"]["file_id"] in state.files
    assert job["result"]["op"] == "pitch_correct"
    assert any("pitch_correct: loading" in line for line in job["progress"])
    assert job["progress_events"], "progress events must carry Progress data"
    assert job["progress_events"][0]["stage"]
