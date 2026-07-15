"""Per-machine time estimates for separation jobs (roadmap §3.3, §9.2).

A tiny JSON-backed calibration store: after each real separation run, the
observed seconds-of-wall-time-per-second-of-audio ratio for
``(model_id, device_kind)`` is folded into a running average and persisted, so
the *next* estimate for that model on *this* machine gets more accurate over
time — "honest software" (roadmap principle 5) means the ETA the UI/CLI shows
should reflect this machine, not a generic number.

Before any calibration data exists, a manifest-driven heuristic (quality
tier) gives a rough first guess so an estimate is always available.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "TimeEstimator",
    "default_stats_path",
    "estimate_seconds",
    "record_run",
    "timed_run",
]

# Seconds of CPU wall time per second of audio, by quality tier — a rough
# first guess used only until real calibration samples exist for a model.
_HEURISTIC_RATE = {
    "draft": 0.15,
    "standard": 0.6,
    "reference": 2.5,
}


def default_stats_path() -> Path:
    from neiro.engine.downloader import default_models_dir

    return default_models_dir().parent / "stats" / "time_estimates.json"


@dataclass
class TimeEstimator:
    """A JSON file of ``{"model::device": {"rate": float, "samples": int}}``."""

    path: Path
    _data: dict = field(default_factory=dict, init=False, repr=False)
    _loaded: bool = field(default=False, init=False, repr=False)

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if self.path.is_file():
            try:
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self._data = {}
        else:
            self._data = {}

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self._data, indent=2, sort_keys=True), encoding="utf-8")
        except OSError:
            pass  # calibration is best-effort; never fail the job over it

    @staticmethod
    def _key(model_id: str, device: str) -> str:
        return f"{model_id}::{device}"

    def record(
        self, model_id: str, device: str, audio_seconds: float, elapsed_seconds: float
    ) -> None:
        if audio_seconds <= 0 or elapsed_seconds <= 0:
            return
        self._ensure_loaded()
        rate = elapsed_seconds / audio_seconds
        key = self._key(model_id, device)
        entry = self._data.get(key, {"rate": rate, "samples": 0})
        n = int(entry.get("samples", 0))
        entry["rate"] = (entry["rate"] * n + rate) / (n + 1) if n else rate
        entry["samples"] = min(n + 1, 50)  # cap history so it stays responsive to change
        self._data[key] = entry
        self._save()

    def estimate(
        self,
        model_id: str,
        device: str,
        audio_seconds: float,
        quality_class: str = "standard",
    ) -> float:
        self._ensure_loaded()
        entry = self._data.get(self._key(model_id, device))
        rate = entry["rate"] if entry else _HEURISTIC_RATE.get(quality_class, 0.6)
        return max(0.05, rate * max(0.0, audio_seconds))

    def samples_for(self, model_id: str, device: str) -> int:
        self._ensure_loaded()
        entry = self._data.get(self._key(model_id, device))
        return int(entry["samples"]) if entry else 0


_default: TimeEstimator | None = None


def _get_default() -> TimeEstimator:
    global _default
    if _default is None:
        _default = TimeEstimator(default_stats_path())
    return _default


def estimate_seconds(
    model_id: str, device: str, audio_seconds: float, quality_class: str = "standard"
) -> float:
    return _get_default().estimate(model_id, device, audio_seconds, quality_class)


def record_run(model_id: str, device: str, audio_seconds: float, elapsed_seconds: float) -> None:
    _get_default().record(model_id, device, audio_seconds, elapsed_seconds)


@contextmanager
def timed_run(model_id: str, device: str, audio_seconds: float) -> Iterator[None]:
    """Context manager: records the block's wall time against ``audio_seconds``."""
    start = time.perf_counter()
    try:
        yield
    finally:
        record_run(model_id, device, audio_seconds, time.perf_counter() - start)
