"""User correction overlay for analysis results (roadmap §9.3 condition editor).

An :class:`~neiro.engine.artifacts.AnalysisReport` is the engine's measurement
— it should never be silently mutated by a user override, because that would
make "what did the pipeline actually detect" unrecoverable, violating roadmap
principle 5 (honest software: confidence and provenance are displayed, not
hidden). Corrections are a separate, sparse overlay keyed by field name; a
planner or UI calls :meth:`AnalysisCorrections.apply` to get an *effective*
view without ever touching the original report — ``report`` is a frozen
dataclass, so this is enforced at both the API and the type level, not just by
convention.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from neiro.engine.artifacts import AnalysisReport

__all__ = ["AnalysisCorrections", "CORRECTABLE_FIELDS"]

# Only measurement-derived fields may be corrected — not identity fields like
# sample_rate/channels/duration_seconds, which describe the file rather than
# something an ear could disagree with.
CORRECTABLE_FIELDS = frozenset(
    {
        "estimated_bpm",
        "estimated_key",
        "vocal_conditions",
        "instruments",
        "sections",
        "chords",
        "downbeats",
        "vocal_rt60_seconds",
        "noise_floor_dbfs",
        "bandwidth_hz",
    }
)


@dataclass
class AnalysisCorrections:
    """Sparse user overrides layered on top of an :class:`AnalysisReport`.

    ``overrides`` maps a correctable field name to its replacement value.
    Nothing here is applied automatically: a caller must run
    :meth:`apply` to get the effective report, which keeps "what did we
    measure" (``report``) and "what did the user say instead"
    (``overrides``) as two distinct, individually inspectable things — the
    UI's condition editor (roadmap §9.3) can show both.
    """

    overrides: dict[str, Any] = field(default_factory=dict)
    reasons: dict[str, str] = field(default_factory=dict)

    def set(self, field_name: str, value: Any, *, reason: str = "") -> None:
        if field_name not in CORRECTABLE_FIELDS:
            raise ValueError(
                f"{field_name!r} is not a correctable AnalysisReport field "
                f"(known: {sorted(CORRECTABLE_FIELDS)})"
            )
        self.overrides[field_name] = value
        if reason:
            self.reasons[field_name] = reason

    def clear(self, field_name: str) -> None:
        self.overrides.pop(field_name, None)
        self.reasons.pop(field_name, None)

    def is_empty(self) -> bool:
        return not self.overrides

    def apply(self, report: AnalysisReport) -> AnalysisReport:
        """Return a *new* report reflecting the corrections; ``report`` is untouched."""
        if not self.overrides:
            return report
        correction_notes = tuple(
            f"corrected: {name}" + (f" ({self.reasons[name]})" if name in self.reasons else "")
            for name in self.overrides
        )
        return replace(report, **self.overrides, notes=tuple(report.notes) + correction_notes)

    def as_dict(self) -> dict[str, Any]:
        return {"overrides": dict(self.overrides), "reasons": dict(self.reasons)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnalysisCorrections:
        overrides = dict(data.get("overrides", {}))
        for name in overrides:
            if name not in CORRECTABLE_FIELDS:
                raise ValueError(f"{name!r} is not a correctable AnalysisReport field")
        return cls(overrides=overrides, reasons=dict(data.get("reasons", {})))
