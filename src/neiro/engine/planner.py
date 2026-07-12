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
from neiro.nodes.audio_nodes import (
    AnalyzeNode,
    CompileNode,
    EnhanceNode,
    IngestNode,
    LaneNode,
    ResidualNode,
    SeparateNode,
    TranscribeNode,
)

__all__ = [
    "SeparationPlan",
    "TranscriptionPlan",
    "EnhancementPlan",
    "plan_separation",
    "plan_transcription",
    "plan_enhancement",
]


# Named presets map to (task, quality, preferred model id or None).
PRESETS: dict[str, dict[str, Any]] = {
    "vocals": {"stems": {"vocals", "instrumental"}, "quality": "standard", "prefer": "dsp-center"},
    "vocals-ensemble": {
        "stems": {"vocals", "instrumental"},
        "quality": "standard",
        "prefer": "dsp-center-ensemble",
    },
    "harmonic": {"stems": {"harmonic", "percussive"}, "quality": "draft", "prefer": "dsp-hpss"},
    "4stem": {
        "stems": {"drums", "bass", "other", "vocals"},
        "quality": "standard",
        "prefer": "htdemucs",
    },
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
        notes.append(
            f"model license: {entry.license_spdx} (see model provenance before commercial use)"
        )

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


@dataclass
class TranscriptionPlan:
    graph: Graph
    compile_node: str
    transcribe_nodes: list[str]
    model_id: str
    used_split: bool
    notes: list[str] = field(default_factory=list)


def _quick_analysis(input_path: str | Path):
    """Plan-time analysis: cheap enough to run while planning (roadmap §2.3)."""
    from neiro.analysis import analyze
    from neiro.io import load_audio

    return analyze(load_audio(input_path))


def plan_transcription(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    mode: str = "auto",
    quantize: bool = True,
    division: int = 4,
) -> TranscriptionPlan:
    """Plan a transcription job.

    Modes:
      - ``direct``: transcribe the mix as-is.
      - ``split``: auto-split first (roadmap §8.1) — separate the vocal/lead
        stem, then transcribe it, avoiding cross-frequency masking.
      - ``auto``: choose — stereo material with side content gets the split
        path (centre extraction has something to work with); mono/effectively
        mono material is decoded directly.
    """
    notes: list[str] = []
    entry = registry.best_for("transcribe", "standard")
    if entry is None:
        raise RuntimeError("no transcription model available")
    if entry.quality_class == "draft":
        notes.append(
            f"{entry.id} is monophonic (melody line only); install a polyphonic "
            "backend (e.g. basic-pitch) for chords and multi-voice material"
        )

    use_split = False
    if mode == "split":
        use_split = True
    elif mode == "auto":
        report = _quick_analysis(input_path)
        use_split = report.channels >= 2 and not report.is_effectively_mono
        if use_split:
            notes.append("auto-split: extracting the centre stem before transcription")
        else:
            notes.append("auto-split skipped: source is mono / effectively mono")

    transcriber = entry.instantiate()
    lane_sr = transcriber.profile.sample_rate or 16000

    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(AnalyzeNode("analyze", ("ingest", "audio")))

    if use_split:
        sep_entry = (
            registry.get("dsp-center") if "dsp-center" in {e.id for e in registry.all()} else None
        )
        sep_entry = sep_entry or registry.best_for(
            "separate", "draft", stems={"vocals", "instrumental"}
        )
        if sep_entry is None:
            use_split = False
            notes.append("no separator available; transcribing the mix directly")
    if use_split:
        separator = sep_entry.instantiate()
        g.add(LaneNode("seplane", ("ingest", "audio"), separator.profile.sample_rate))
        g.add(SeparateNode("split", ("seplane", "audio"), separator, vram))
        g.add(LaneNode("lane", ("split", "vocals"), lane_sr, mono=True))
    else:
        g.add(LaneNode("lane", ("ingest", "audio"), lane_sr, mono=True))

    g.add(TranscribeNode("transcribe", ("lane", "audio"), transcriber, vram))
    g.add(
        CompileNode(
            "compile",
            streams={"melody": ("transcribe", "notes")},
            report=("analyze", "report"),
            quantize=quantize,
            division=division,
        )
    )

    return TranscriptionPlan(
        graph=g,
        compile_node="compile",
        transcribe_nodes=["transcribe"],
        model_id=entry.id,
        used_split=use_split,
        notes=notes,
    )


@dataclass
class EnhancementPlan:
    graph: Graph
    output_node: str
    chain: list[str]
    notes: list[str] = field(default_factory=list)


# Explicit chain steps a user can request by name.
ENHANCE_STEPS = {
    "declip": "dsp-declip",
    "dehum": "dsp-dehum",
    "denoise": "dsp-denoise",
    "normalize": "dsp-normalize",
}


def plan_enhancement(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    chain: list[str] | None = None,
) -> EnhancementPlan:
    """Plan a restoration job.

    With ``chain=None`` the planner builds a conditioning chain from detected
    conditions (roadmap §6.2): declip if clipping, dehum if mains hum. Explicit
    chains name steps from ``ENHANCE_STEPS`` in order.
    """
    notes: list[str] = []
    steps: list[tuple[str, dict]] = []

    if chain is None:
        report = _quick_analysis(input_path)
        if report.clipping_ratio > 0.0005:
            steps.append(("declip", {}))
            notes.append("clipping detected -> declip")
        hum_hz = report.vocal_conditions.get("hum_hz")
        if hum_hz:
            steps.append(("dehum", {"fundamental": float(hum_hz)}))
            notes.append(f"mains hum at {hum_hz:.0f} Hz -> dehum")
        if not steps:
            notes.append("no repairable conditions detected; nothing to do")
    else:
        for name in chain:
            if name not in ENHANCE_STEPS:
                raise ValueError(
                    f"unknown enhancement step {name!r}; known: {', '.join(ENHANCE_STEPS)}"
                )
            steps.append((name, {}))

    g = Graph()
    g.add(IngestNode("ingest", input_path))
    upstream: tuple[str, str] = ("ingest", "audio")
    applied: list[str] = []
    for i, (name, overrides) in enumerate(steps):
        entry = registry.get(ENHANCE_STEPS[name])
        enhancer = entry.instantiate()
        for k, v in overrides.items():
            setattr(enhancer, k, v)
        node_id = f"enhance_{i}_{name}"
        g.add(EnhanceNode(node_id, upstream, enhancer, vram))
        upstream = (node_id, "audio")
        applied.append(name)

    return EnhancementPlan(graph=g, output_node=upstream[0], chain=applied, notes=notes)
