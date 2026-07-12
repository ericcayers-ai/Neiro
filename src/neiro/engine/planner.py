"""The Planner (roadmap §2.3).

Turns (intent, registry, hardware) into a concrete DAG. Simple mode calls this
with defaults; Advanced mode would surface the emitted graph for editing. Today
it plans separation jobs; transcription and enhancement plans attach here as
those node families land.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from neiro.engine.graph import Graph
from neiro.engine.registry import Registry
from neiro.engine.vram import VRAMManager
from neiro.nodes.audio_nodes import IngestNode, LaneNode, AnalyzeNode, SeparateNode, ResidualNode

__all__ = ["SeparationPlan", "plan_separation"]


# Named presets map to (task, quality, preferred model id or None).
PRESETS: dict[str, dict[str, Any]] = {
    "vocals": {"stems": {"vocals", "instrumental"}, "quality": "standard", "prefer": "dsp-center"},
    "harmonic": {"stems": {"harmonic", "percussive"}, "quality": "draft", "prefer": "dsp-hpss"},
    "4stem": {"stems": {"drums", "bass", "other", "vocals"}, "quality": "standard", "prefer": "htdemucs"},
}


@dataclass
class SeparationPlan:
    graph: Graph
    separate_node: str
    stem_ports: list[str]
    source_node: str  # node whose "audio" port is the reference for the null test
    residual_node: str | None
    model_id: str
    model_available: bool
    notes: list[str] = field(default_factory=list)


def plan_separation(
    input_path: str | Path,
    preset: str,
    registry: Registry,
    vram: VRAMManager,
    *,
    with_residual: bool = True,
) -> SeparationPlan:
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}; known: {', '.join(PRESETS)}")
    spec = PRESETS[preset]
    notes: list[str] = []

    # Model selection: honour the preset's preference, else best available.
    entry = None
    prefer = spec.get("prefer")
    if prefer:
        try:
            candidate = registry.get(prefer)
            if candidate.available():
                entry = candidate
            else:
                notes.append(f"{prefer} unavailable (missing deps); choosing a fallback")
        except KeyError:
            pass
    if entry is None:
        entry = registry.best_for("separate", spec["quality"], stems=spec["stems"])
    if entry is None:
        raise RuntimeError("no separation model available for this preset")

    separator = entry.instantiate()

    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(LaneNode("lane", ("ingest", "audio"), separator.profile.sample_rate))
    g.add(SeparateNode("separate", ("lane", "audio"), separator, vram))

    stem_ports = list(separator.profile.stems)
    residual_node = None
    if with_residual:
        stems = {name: ("separate", name) for name in stem_ports}
        g.add(ResidualNode("residual", ("lane", "audio"), stems))
        residual_node = "residual"

    if entry.license_spdx not in ("MIT", "Apache-2.0", "BSD-3-Clause", "builtin"):
        notes.append(f"model license: {entry.license_spdx} (see model provenance before commercial use)")

    return SeparationPlan(
        graph=g,
        separate_node="separate",
        stem_ports=stem_ports,
        source_node="lane",
        residual_node=residual_node,
        model_id=entry.id,
        model_available=entry.available(),
        notes=notes,
    )
