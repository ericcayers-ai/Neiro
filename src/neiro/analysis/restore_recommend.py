"""Multi-condition restore detector → recommended chain + plain-language why.

Aligns with :data:`neiro.engine.planner.ENHANCE_STEPS` and the layman Restore
presets in the UI (Clean recording / Old & noisy / Fix clipping / More air /
Match reference / Auto).
"""

from __future__ import annotations

from typing import Any

# Layman preset id → explicit ENHANCE_STEPS chain (None = auto from report).
LAYMAN_PRESETS: dict[str, list[str] | None] = {
    "auto": None,
    "clean": ["declick", "dehum", "normalize"],
    "old-noisy": ["declick", "dehum", "denoise", "normalize"],
    "fix-clipping": ["declip", "normalize"],
    "more-air": ["restore", "normalize"],
    "match-reference": ["master"],
}

# Alias strings the UI / CLI may send (comma-chains still pass through).
LAYMAN_ALIASES: dict[str, str] = {
    "auto": "auto",
    "clean": "clean",
    "clean-recording": "clean",
    "old-noisy": "old-noisy",
    "old_noisy": "old-noisy",
    "fix-clipping": "fix-clipping",
    "fix_clipping": "fix-clipping",
    "more-air": "more-air",
    "more_air": "more-air",
    "match-reference": "match-reference",
    "match_reference": "match-reference",
    "master": "match-reference",
}


def resolve_layman_chain(raw: str | list[str] | None) -> list[str] | None:
    """Map a UI chain string to ENHANCE_STEPS names, or None for auto."""
    if raw is None or raw == "" or raw == "auto":
        return None
    if isinstance(raw, list):
        if len(raw) == 1 and str(raw[0]) in LAYMAN_ALIASES:
            return LAYMAN_PRESETS[LAYMAN_ALIASES[str(raw[0])]]
        return [str(s).strip() for s in raw if str(s).strip()]
    key = str(raw).strip().lower()
    if key in LAYMAN_ALIASES:
        return LAYMAN_PRESETS[LAYMAN_ALIASES[key]]
    # Explicit comma chain
    if "," in key:
        return [s.strip() for s in key.split(",") if s.strip()]
    # Single step name
    return [key]


def recommend_enhance_chain(report: Any) -> dict[str, Any]:
    """Rank restoration conditions and build a recommended chain + why text.

    Votes are independent signals from the analysis report. The returned
    ``chain`` uses only DSP-safe auto steps by default; neural suggestions
    (dereverb / denoise / restore) are listed separately so Auto stays
    deterministic across machines (matching ``plan_enhancement``).
    """
    votes: list[tuple[str, float, str]] = []
    vc = getattr(report, "vocal_conditions", None) or {}
    if not isinstance(vc, dict):
        vc = {}

    clip = float(getattr(report, "clipping_ratio", 0.0) or 0.0)
    if clip > 0.0005:
        votes.append(
            (
                "declip",
                min(1.0, clip * 800),
                f"Clipping on ~{clip * 100:.2f}% of samples — peaks need reconstruction.",
            )
        )

    hum_hz = vc.get("hum_hz")
    if hum_hz:
        prom = float(vc.get("hum_prominence_db") or 30.0)
        votes.append(
            (
                "dehum",
                min(1.0, (prom - 25.0) / 40.0 + 0.5),
                f"Mains hum around {float(hum_hz):.0f} Hz — notch it out.",
            )
        )

    noise_floor = getattr(report, "noise_floor_dbfs", None)
    if isinstance(noise_floor, (int, float)) and noise_floor > -45.0:
        votes.append(
            (
                "denoise",
                min(1.0, (noise_floor + 55.0) / 25.0),
                f"Noise floor ~{noise_floor:.0f} dBFS — broadband denoise helps.",
            )
        )

    # Clicks / crackle proxy: very low noise floor + clipping often co-occur with
    # vinyl/transfer clicks; also elevate when notes mention declick-worthy damage.
    notes = list(getattr(report, "notes", ()) or ())
    note_blob = " ".join(str(n).lower() for n in notes)
    if "click" in note_blob or "crackle" in note_blob or clip > 0.002:
        votes.append(
            (
                "declick",
                0.55 if clip > 0.002 else 0.45,
                "Transient spikes / transfer clicks — light declick cleans them up.",
            )
        )

    echo_s = vc.get("echo_delay_s")
    rt60 = vc.get("rt60_s")
    if echo_s is not None or (isinstance(rt60, (int, float)) and rt60 > 0.55):
        conf = float(vc.get("echo_confidence") or 0.5)
        delay_ms = int(round(float(echo_s) * 1000)) if echo_s is not None else None
        why = (
            f"Discrete echo ~{delay_ms} ms — neural dereverb when installed."
            if delay_ms is not None
            else f"Room reverb (RT60 ~{float(rt60):.1f} s) — consider dereverb."
        )
        votes.append(("dereverb", min(1.0, 0.4 + conf * 0.5), why))

    bw = getattr(report, "bandwidth_hz", None)
    if isinstance(bw, (int, float)) and bw < 16000:
        votes.append(
            (
                "restore",
                min(1.0, (16000 - bw) / 8000),
                f"Bandwidth only ~{bw / 1000:.1f} kHz — More air / restore extends it.",
            )
        )

    votes.sort(key=lambda v: v[1], reverse=True)

    # Auto DSP chain (deterministic; neural steps are suggestions only).
    auto_steps: list[str] = []
    why_parts: list[str] = []
    for step, score, reason in votes:
        if score < 0.35:
            continue
        if step in ("declip", "declick", "dehum") and step not in auto_steps:
            auto_steps.append(step)
            why_parts.append(reason)
        elif step in ("denoise", "dereverb", "restore"):
            why_parts.append(reason)

    suggested_neural = [
        s for s, score, _ in votes if s in ("denoise", "dereverb", "restore") and score >= 0.35
    ]

    # Map top conditions → a layman preset hint for the UI.
    preset_hint = "auto"
    step_set = {s for s, score, _ in votes if score >= 0.4}
    if "declip" in step_set and len(step_set) <= 2:
        preset_hint = "fix-clipping"
    elif "restore" in step_set and ("denoise" in step_set or "declick" in step_set):
        preset_hint = "old-noisy"
    elif "restore" in step_set:
        preset_hint = "more-air"
    elif "denoise" in step_set or "declick" in step_set:
        preset_hint = "old-noisy" if "denoise" in step_set else "clean"
    elif "dehum" in step_set or "declick" in step_set:
        preset_hint = "clean"

    if not why_parts:
        why = "Nothing loud stood out — Auto will leave the file alone or only light-touch DSP."
    else:
        why = " ".join(why_parts[:3])

    return {
        "chain": auto_steps,
        "suggested_neural": suggested_neural,
        "why": why,
        "preset_hint": preset_hint,
        "votes": [
            {"step": s, "score": round(score, 2), "reason": reason} for s, score, reason in votes
        ],
    }
