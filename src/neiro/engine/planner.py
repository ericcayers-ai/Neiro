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


# Named presets map to a stem set, a quality tier, and an ordered preference
# list of model ids. The planner walks the preference list and picks the first
# model that is *available* (dependency installed), preferring downloaded ones;
# it falls back to the DSP floor if no neural model is usable, so every preset
# works on a fresh install and gets better as models are downloaded.
PRESETS: dict[str, dict[str, Any]] = {
    # Model-free floor presets.
    "vocals": {"stems": {"vocals", "instrumental"}, "quality": "draft", "prefer": ["dsp-center"]},
    "vocals-ensemble": {
        "stems": {"vocals", "instrumental"},
        "quality": "standard",
        "prefer": ["dsp-center-ensemble"],
    },
    "vocals-neural-ensemble": {
        "stems": {"vocals", "instrumental"},
        "quality": "reference",
        "prefer": ["vocals-neural-ensemble", "dsp-center-ensemble"],
    },
    "harmonic": {"stems": {"harmonic", "percussive"}, "quality": "draft", "prefer": ["dsp-hpss"]},
    # Neural presets — best current models first, DSP floor last as a safety net.
    "vocals-best": {
        "stems": {"vocals", "instrumental"},
        "quality": "reference",
        "prefer": [
            "vocals-neural-ensemble",
            "bs-roformer-1297",
            "mel-roformer-inst",
            "mdx23c-instvoc",
            "dsp-center-ensemble",
        ],
    },
    "karaoke": {
        "stems": {"vocals", "instrumental"},
        "quality": "reference",
        "prefer": ["mel-roformer-karaoke", "dsp-center"],
    },
    "4stem": {
        "stems": {"drums", "bass", "other", "vocals"},
        "quality": "standard",
        "prefer": ["htdemucs-ft"],
    },
    "6stem": {
        "stems": {"drums", "bass", "other", "vocals", "guitar", "piano"},
        "quality": "standard",
        "prefer": ["htdemucs-6s"],
    },
    "drums": {
        "stems": {"kick", "snare", "toms", "hh", "ride", "crash"},
        "quality": "reference",
        "prefer": ["mdx23c-drumsep"],
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


def _has(registry: Registry, model_id: str) -> bool:
    try:
        registry.get(model_id)
        return True
    except KeyError:
        return False


def _resolve(
    registry: Registry,
    prefer: list[str],
    notes: list[str],
    *,
    auto_download: bool = True,
    progress=None,
):
    """Resolve a preference list to a ready-to-use model entry.

    Preference order puts the best (typically neural) model first. The chosen
    model is the highest-priority *available* one (its Python dependency is
    installed). If its weights aren't present yet:

    * ``auto_download`` (default): fetch them now — this is what makes neural
      models "just work" on first use rather than sitting on the back burner.
    * otherwise: fall back to the highest-priority model that is already
      downloaded (the DSP floor, in practice), noting how to get the better one.

    Returns ``(entry, None)`` on success, or ``(None, None)`` if nothing in the
    list is available at all.
    """
    available = []
    for model_id in prefer:
        if not _has(registry, model_id):
            continue
        entry = registry.get(model_id)
        if entry.available():
            available.append(entry)
    if not available:
        return None, None

    top = available[0]
    if top.downloaded():
        return top, None

    if auto_download:
        notes.append(f"downloading {top.id} weights (first use, one time)")
        top.ensure_downloaded(progress=progress)
        return top, None

    # Offline: use the best already-downloaded option instead.
    for entry in available:
        if entry.downloaded():
            notes.append(
                f"{top.id} not downloaded; using {entry.id} "
                f"(run 'neiro download {top.id}' for the better model)"
            )
            return entry, None
    notes.append(f"{top.id} weights not downloaded; run 'neiro download {top.id}'")
    return top, None


# Back-compat shim: some call sites used the older two-return-value form.
def _select_model(registry: Registry, prefer: list[str], notes: list[str]):
    entry, _ = _resolve(registry, prefer, notes, auto_download=False)
    return entry, (entry.needs_download and not entry.downloaded()) if entry else False


def plan_separation(
    input_path: str | Path,
    preset: str,
    registry: Registry,
    vram: VRAMManager,
    *,
    with_residual: bool = True,
    auto_download: bool = True,
    progress=None,
) -> SeparationPlan:
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}; known: {', '.join(PRESETS)}")
    spec = PRESETS[preset]
    notes: list[str] = []

    prefer = list(spec.get("prefer", []))
    entry, _ = _resolve(registry, prefer, notes, auto_download=auto_download, progress=progress)
    if entry is None:
        # Nothing in the preference list is usable; fall back to any DSP model.
        entry = registry.best_for("separate", "draft", stems=spec["stems"])
        if entry is None:
            raise RuntimeError("no separation model available for this preset")
        notes.append(f"preferred models unavailable; using {entry.id}")

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


# Transcription model preference: piano-specific > general polyphonic > DSP floor.
TRANSCRIBE_PREFER = ["piano-transcription", "basic-pitch", "dsp-yin"]


def plan_transcription(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    mode: str = "auto",
    quantize: bool = True,
    division: int = 4,
    model: str | None = None,
    auto_download: bool = True,
    progress=None,
) -> TranscriptionPlan:
    """Plan a transcription job.

    Modes:
      - ``direct``: transcribe the mix as-is.
      - ``split``: auto-split first (roadmap §8.1) — separate the vocal/lead
        stem, then transcribe it, avoiding cross-frequency masking.
      - ``auto``: choose — stereo material with side content gets the split
        path (centre extraction has something to work with); mono/effectively
        mono material is decoded directly.

    ``model`` forces a specific transcriber id; otherwise the best available
    from :data:`TRANSCRIBE_PREFER` (polyphonic neural models first) is used and
    downloaded on demand.
    """
    notes: list[str] = []
    if model:
        entry = registry.get(model)
        if not entry.available():
            raise RuntimeError(f"{model} is not available (missing dependency)")
        if entry.needs_download and not entry.downloaded():
            if auto_download:
                notes.append(f"downloading {entry.id} weights (first use)")
                entry.ensure_downloaded(progress=progress)
            else:
                notes.append(f"{entry.id} weights not downloaded; run 'neiro download {entry.id}'")
    else:
        entry, _ = _resolve(
            registry, TRANSCRIBE_PREFER, notes, auto_download=auto_download, progress=progress
        )
        if entry is None:
            entry = registry.best_for("transcribe", "standard")
    if entry is None:
        raise RuntimeError("no transcription model available")

    if entry.quality_class == "draft":
        notes.append(
            f"{entry.id} is monophonic (melody line only); a polyphonic "
            "backend (piano-transcription / basic-pitch) gives chords and multi-voice"
        )
    if entry.license_spdx == "unknown":
        notes.append(f"{entry.id}: {entry.license_note or 'license unverified — research use'}")

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


# Explicit chain steps a user can request by name. Each maps to an ordered
# preference of model ids (neural first, DSP floor as fallback) so a step name
# resolves to the best available implementation and downloads it on demand.
ENHANCE_STEPS: dict[str, list[str]] = {
    "declip": ["dsp-declip"],
    "dehum": ["dsp-dehum"],
    "denoise": ["denoise-roformer", "dsp-denoise"],
    "dereverb": ["dereverb-roformer"],
    "superres": ["audiosr"],
    "master": ["matchering"],
    "normalize": ["dsp-normalize"],
}


def plan_enhancement(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    chain: list[str] | None = None,
    auto_download: bool = True,
    progress=None,
    reference_path: str | None = None,
) -> EnhancementPlan:
    """Plan a restoration job.

    With ``chain=None`` the planner builds a conditioning chain from detected
    conditions (roadmap §6.2): declip if clipping, dehum if mains hum, dereverb
    if reverb was detected. Explicit chains name steps from ``ENHANCE_STEPS``.
    Each step resolves to the best available model (neural preferred) and is
    downloaded on demand.
    """
    notes: list[str] = []
    steps: list[tuple[str, dict]] = []

    auto_chain = chain is None
    if auto_chain:
        # The automatic conditioning chain (roadmap §6.2) stays on the
        # zero-friction DSP floor — it must never silently trigger a large model
        # download. Neural repair (dereverb/denoise/superres) is powerful but
        # opt-in: detected conditions that a neural model would fix best are
        # surfaced as suggestions, and applied when the user asks for them
        # explicitly (an explicit --chain, or the UI's restore options).
        report = _quick_analysis(input_path)
        if report.clipping_ratio > 0.0005:
            steps.append(("declip", {}))
            notes.append("clipping detected -> declip")
        hum_hz = report.vocal_conditions.get("hum_hz")
        if hum_hz:
            steps.append(("dehum", {"fundamental": float(hum_hz)}))
            notes.append(f"mains hum at {hum_hz:.0f} Hz -> dehum")
        # Neural repairs are deliberately *not* auto-added: doing so would make
        # the auto chain depend on which models happen to be downloaded (i.e.
        # non-deterministic across machines) and could silently pull a large
        # model. They're surfaced as suggestions the user opts into instead.
        if report.vocal_conditions.get("echo_delay_s"):
            notes.append("reverb/echo detected — 'enhance --chain dereverb' for neural de-reverb")
        if report.bandwidth_hz and report.bandwidth_hz < 16000:
            notes.append("limited bandwidth — 'enhance --chain superres' can extend it (AudioSR)")
        if not steps:
            notes.append("no auto-repairable conditions detected")
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
        entry, _ = _resolve(
            registry, ENHANCE_STEPS[name], notes, auto_download=auto_download, progress=progress
        )
        if entry is None:
            notes.append(f"step {name!r}: no available model, skipped")
            continue
        if entry.needs_download and not entry.downloaded():
            notes.append(f"{entry.id} not downloaded; skipping {name}")
            continue
        enhancer = entry.instantiate()
        if name == "master" and reference_path is not None:
            enhancer.reference_path = reference_path
        for k, v in overrides.items():
            setattr(enhancer, k, v)
        if entry.id != ENHANCE_STEPS[name][-1]:
            notes.append(f"{name}: using {entry.id}")
        node_id = f"enhance_{i}_{name}"
        g.add(EnhanceNode(node_id, upstream, enhancer, vram))
        upstream = (node_id, "audio")
        applied.append(name)

    return EnhancementPlan(graph=g, output_node=upstream[0], chain=applied, notes=notes)
