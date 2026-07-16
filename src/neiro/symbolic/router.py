"""Decoder router (roadmap §7.2, §8.1): instrument -> decoder preference.

Separation gives the planner *stems*; transcription needs a second mapping —
which decoder(s) actually understand a given instrument. This module is the
single place that mapping lives, so adding a new decoder (a manifest + an
adapter) only means adding it to a preference list here, not touching the
planner or orchestrator.

Each instrument name (as produced by :mod:`neiro.analysis.report`'s heuristic
tagger, or typed by a user in Advanced mode) resolves to an ordered list of
model ids: primary specialist(s) first, general-purpose polyphonic decoders
next, the dependency-free DSP floor last. :func:`resolve` walks that list
against a :class:`~neiro.engine.registry.Registry` and returns the first
*available* entry, so every instrument transcribes on a fresh install (DSP
floor) and gets better as models are downloaded — the same pattern the
separation planner uses for stems.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from neiro.engine.registry import ModelEntry, Registry

__all__ = [
    "INSTRUMENT_DECODERS",
    "LYRICS_DECODERS",
    "DEFAULT_DECODERS",
    "LATENCY_SECONDS",
    "decoders_for",
    "resolve",
    "latency_for",
]


# Primary/fallback decoder ids per instrument family. Order matters: the first
# *available* (dependency installed) entry wins. "dsp-yin" terminates every
# pitched list — it has no dependency and no weights, so it is always available
# and every instrument has an honest floor even with nothing downloaded.
INSTRUMENT_DECODERS: dict[str, list[str]] = {
    "piano": ["transkun-piano", "piano-transcription", "yourmt3", "basic-pitch", "dsp-yin"],
    "keys": ["transkun-piano", "piano-transcription", "yourmt3", "basic-pitch", "dsp-yin"],
    "keyboard": ["transkun-piano", "piano-transcription", "yourmt3", "basic-pitch", "dsp-yin"],
    "organ": ["piano-transcription", "yourmt3", "basic-pitch", "dsp-yin"],
    "electric guitar": ["timbre-amt", "yourmt3", "basic-pitch", "dsp-yin"],
    "acoustic guitar": ["timbre-amt", "yourmt3", "basic-pitch", "dsp-yin"],
    "guitar": ["timbre-amt", "yourmt3", "basic-pitch", "dsp-yin"],
    "bass": ["yourmt3", "basic-pitch", "dsp-yin"],
    "drums": ["noise-to-notes", "drums-neural", "drums-dsp"],
    "percussion": ["noise-to-notes", "drums-neural", "drums-dsp"],
    "kit": ["noise-to-notes", "drums-neural", "drums-dsp"],
    "vocals": ["svt-melody", "basic-pitch", "dsp-yin"],
    "lead vocal": ["svt-melody", "basic-pitch", "dsp-yin"],
    "strings": ["yourmt3", "multi-instrument", "basic-pitch", "dsp-yin"],
    "violin": ["yourmt3", "basic-pitch", "dsp-yin"],
    "winds": ["yourmt3", "basic-pitch", "dsp-yin"],
    "brass": ["yourmt3", "basic-pitch", "dsp-yin"],
    "saxophone": ["yourmt3", "basic-pitch", "dsp-yin"],
    "flute": ["yourmt3", "basic-pitch", "dsp-yin"],
    "synth": ["yourmt3", "multi-instrument", "basic-pitch", "dsp-yin"],
    "woodwinds": ["yourmt3", "basic-pitch", "dsp-yin"],
}

# Lyrics are a separate track family (text, not pitched notes) — routed
# independently of the note decoders above.
LYRICS_DECODERS: list[str] = ["whisper-lyrics"]

# Multi-instrument / whole-mix decode (roadmap §7.2's "hears context" pass, and
# the fallback when an instrument has no dedicated entry above).
DEFAULT_DECODERS: list[str] = ["yourmt3", "multi-instrument", "basic-pitch", "dsp-yin"]

# Per-model algorithmic latency (seconds) measured by impulse/click calibration
# (see :func:`neiro.symbolic.orchestrate.calibrate_latency`). Values default to
# 0.0 (uncalibrated / negligible) until a calibration run populates them;
# ``latency_for`` always returns a float so compensation code never branches
# on "was this calibrated?".
LATENCY_SECONDS: dict[str, float] = {
    "dsp-yin": 0.0,
    "basic-pitch": 0.0,
    "piano-transcription": 0.0,
    "transkun-piano": 0.0,
    "drums-dsp": 0.0,
    "drums-neural": 0.0,
    "noise-to-notes": 0.0,
    "multi-instrument": 0.0,
    "yourmt3": 0.0,
    "svt-melody": 0.0,
    "timbre-amt": 0.0,
    "whisper-lyrics": 0.0,
}


def decoders_for(instrument: str) -> list[str]:
    """Preference list of decoder ids for an instrument name (case-insensitive)."""
    return list(INSTRUMENT_DECODERS.get(instrument.strip().lower(), DEFAULT_DECODERS))


def latency_for(model_id: str) -> float:
    """Measured (or default 0.0) algorithmic latency in seconds for a decoder."""
    return LATENCY_SECONDS.get(model_id, 0.0)


def resolve(
    registry: Registry,
    instrument: str,
    *,
    prefer: list[str] | None = None,
) -> tuple[ModelEntry | None, list[str]]:
    """Pick the best *available* decoder for an instrument.

    Returns ``(entry_or_None, notes)``. Unlike the planner's
    :func:`neiro.engine.planner._resolve`, this never auto-downloads — routing
    is a cheap, synchronous decision; the caller (planner/orchestrator) decides
    whether to fetch weights for the chosen id.
    """
    notes: list[str] = []
    candidates = prefer if prefer is not None else decoders_for(instrument)
    for model_id in candidates:
        try:
            entry = registry.get(model_id)
        except KeyError:
            continue
        if entry.available():
            if model_id != candidates[0]:
                notes.append(f"{instrument}: preferred decoder unavailable, using {model_id}")
            return entry, notes
    notes.append(f"{instrument}: no decoder available in {candidates!r}")
    return None, notes
