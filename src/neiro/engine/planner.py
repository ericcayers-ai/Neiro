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
    BleedSuppressNode,
    CascadeBandNode,
    CascadeCenterNode,
    CascadeHpssNode,
    CompileNode,
    EnhanceNode,
    GatherNode,
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
    "RestemPlan",
    "plan_separation",
    "plan_transcription",
    "plan_enhancement",
    "plan_restem",
    "TIER_PARAMS",
    "PRESETS",
    "ENHANCE_STEPS",
]


# Named presets map to a stem set, a quality tier, and an ordered preference
# list of model ids. The planner walks the preference list and picks the first
# model that is *available* (dependency installed), preferring downloaded ones;
# it falls back to the DSP floor if no neural model is usable, so every preset
# works on a fresh install and gets better as models are downloaded.
#
# `detect-all`, `cinematic`, and `drums-deep-dive` are cascades built by their
# own functions below (they can't be expressed as "resolve one model"); they
# still get an entry here purely for discoverability (stems/default quality),
# see the dispatch at the top of :func:`plan_separation`.
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
    "duet-vocals": {
        "stems": {"singer1", "singer2", "instrumental"},
        "quality": "reference",
        "prefer": ["medley-vox", "mel-roformer-karaoke", "dsp-center"],
    },
    "4stem": {
        "stems": {"drums", "bass", "other", "vocals"},
        "quality": "standard",
        "prefer": ["scnet", "htdemucs-ft"],
    },
    "6stem": {
        "stems": {"drums", "bass", "other", "vocals", "guitar", "piano"},
        "quality": "standard",
        "prefer": ["htdemucs-6s"],
    },
    "drums": {
        "stems": {"kick", "snare", "toms", "hh", "ride", "crash"},
        "quality": "reference",
        "prefer": ["mdx23c-drumsep", "dsp-drumkit"],
    },
    "drums-deep-dive": {
        "stems": {"kick", "snare", "toms", "hh", "drum_other", "bass", "vocals", "other"},
        "quality": "reference",
        "prefer": [],  # built by _plan_drums_deep_dive
    },
    "detect-all": {
        "stems": {"vocals", "drums", "bass", "other"},
        "quality": "standard",
        "prefer": [],  # built by _plan_detect_all
    },
    "cinematic": {
        "stems": {"dialog", "fx", "music"},
        "quality": "standard",
        "prefer": [],  # built by _plan_cinematic
    },
}

# Quality tiers (roadmap §5.2 "Dual-tier processing"): wired into per-model
# overlap, whether test-time augmentation runs, and (for ensembles) whether
# the full weighted blend or just the strongest member runs.
TIER_PARAMS: dict[str, dict[str, Any]] = {
    "draft": {"overlap": 0.1, "tta": False},
    "standard": {"overlap": 0.25, "tta": True},
    "reference": {"overlap": 0.5, "tta": True},
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
    quality: str = "standard"
    bleed_node: str | None = None
    estimated_seconds: float | None = None
    intermediate: dict[str, tuple[str, str]] = field(default_factory=dict)


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


def _apply_quality_tier(separator: Any, tier: str, notes: list[str]) -> Any:
    """Wire a quality tier into overlap / TTA / ensemble weighting (roadmap §5.2-5.3).

    * ``overlap`` is set on the separator's profile directly — it feeds the
      chunked-inference overlap-add in :mod:`neiro.dsp.chunking`.
    * TTA: ensembles (which carry their own ``.tta`` flag) get it toggled
      in place; a plain single-model separator gets wrapped in
      :class:`~neiro.adapters.ensemble_separator.TTASeparator` when the tier
      calls for TTA, so Standard/Reference get the SDR bump even before any
      neural ensemble is installed.
    * Ensemble weights: Draft narrows an ensemble to its single strongest
      member (near-single-model latency); Standard/Reference keep the
      manifest's full weighted blend.

    Returns the separator to actually run (possibly wrapped).
    """
    params = TIER_PARAMS.get(tier, TIER_PARAMS["standard"])
    separator.profile.overlap = params["overlap"]

    if hasattr(separator, "tta"):
        separator.tta = params["tta"]
        wrapped = separator
    elif params["tta"]:
        from neiro.adapters.ensemble_separator import TTASeparator

        wrapped = TTASeparator(separator)
    else:
        wrapped = separator

    target = getattr(wrapped, "inner", wrapped)
    members = getattr(target, "members", None)
    if members and len(members) > 1 and hasattr(target, "weights"):
        if tier == "draft":
            top = max(range(len(target.weights)), key=lambda i: target.weights[i])
            target.weights = [1.0 if i == top else 0.0 for i in range(len(target.weights))]
            notes.append(
                f"quality=draft: ensemble narrowed to its strongest member "
                f"({members[top].profile.model_id})"
            )

    notes.append(
        f"quality={tier}: overlap {params['overlap']:.0%}, TTA {'on' if params['tta'] else 'off'}"
    )
    return wrapped


def _probe_duration_seconds(path: str | Path) -> float | None:
    """Cheap duration probe (no full decode) for the time estimator."""
    try:
        import soundfile as sf

        info = sf.info(str(path))
        if info.samplerate:
            return float(info.frames) / float(info.samplerate)
    except Exception:
        pass
    return None


# Preference order for restoration models applied *before* separation when a
# lossy-codec bandwidth ceiling is detected (roadmap §6.2). Never auto-
# downloaded here — only used if already present, so a Simple-mode job never
# silently triggers a multi-GB download; otherwise it's surfaced as a note.
RESTORE_BEFORE_SEPARATION_PREFER = ["apollo", "sonicmaster", "audiosr"]


def _maybe_prepend_restoration(
    g: Graph,
    upstream: tuple[str, str],
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    notes: list[str],
    intermediate: dict[str, tuple[str, str]],
    *,
    enabled: bool,
) -> tuple[str, str]:
    """Analysis-driven pre-separation restore (roadmap §6.2, item 7).

    Detects a lossy-codec bandwidth ceiling and, if a restoration model is
    already downloaded, inserts it before separation automatically; if not,
    leaves a note pointing at how to get it. Never auto-downloads — that
    would make "just separate this song" secretly fetch a multi-GB model.
    """
    if not enabled:
        return upstream
    try:
        report = _quick_analysis(input_path)
    except Exception:
        return upstream
    if report.bandwidth_hz is None or report.bandwidth_hz >= 16000:
        return upstream

    entry, _ = _resolve(registry, RESTORE_BEFORE_SEPARATION_PREFER, [], auto_download=False)
    if entry is not None and entry.downloaded():
        enhancer = entry.instantiate()
        g.add(EnhanceNode("pre_restore", upstream, enhancer, vram))
        notes.append(
            f"lossy-source bandwidth (~{report.bandwidth_hz / 1000:.1f} kHz) detected -> "
            f"auto-applied {entry.id} restoration before separation"
        )
        intermediate["pre_restore_input"] = upstream
        return ("pre_restore", "audio")

    notes.append(
        f"lossy-source bandwidth (~{report.bandwidth_hz / 1000:.1f} kHz) detected — "
        "restoration before separation may improve results; install Apollo/SonicMaster "
        "for this to apply automatically, or run 'neiro enhance --chain restore' first"
    )
    return upstream


def _build_extract_cascade(
    g: Graph,
    upstream: tuple[str, str],
    steps: list[tuple[str, str, dict]],
    final_name: str,
    registry: Registry,
    vram: VRAMManager,
    notes: list[str],
    *,
    auto_download: bool,
    progress,
    quality: str,
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Run a generic extract-subtract cascade (roadmap §5.5 detect-all/cinematic).

    Each step extracts ``target_name`` from the current remainder and passes
    the complement on to the next step; the final remainder is exposed as
    ``final_name``. Every step is genuinely energy-conserving DSP (centre
    extract, HPSS, or a low-pass band split), so the cascade's running
    residual stays meaningful throughout — this is what "extract, subtract,
    extract next from remainder" means concretely on the DSP floor. A step
    prefers a neural model from its own ``prefer`` list when one is available
    and already downloaded, per the same resolution rule as everything else.
    """
    from neiro.adapters.dsp_separators import CenterSeparator

    stem_sources: dict[str, tuple[str, str]] = {}
    model_ids: list[str] = []
    remainder = upstream
    for i, (kind, target_name, params) in enumerate(steps):
        node_id = f"cascade_{i}_{target_name}"
        rem_port = f"{target_name}_remainder"
        if kind == "center":
            prefer = params.get("prefer", ["dsp-center"])
            entry, _ = _resolve(registry, prefer, notes, auto_download=auto_download, progress=progress)
            base_sep = entry.instantiate() if entry is not None else CenterSeparator()
            sep = _apply_quality_tier(base_sep, quality, notes)
            g.add(
                CascadeCenterNode(
                    node_id, remainder, sep, vram, target_name=target_name, complement_name=rem_port
                )
            )
            model_ids.append(getattr(getattr(sep, "inner", sep), "profile").model_id)
        elif kind == "hpss":
            g.add(
                CascadeHpssNode(
                    node_id, remainder, target_name=target_name, complement_name=rem_port
                )
            )
            model_ids.append("dsp-hpss")
        elif kind == "band":
            g.add(
                CascadeBandNode(
                    node_id,
                    remainder,
                    target_name=target_name,
                    complement_name=rem_port,
                    cutoff_hz=params.get("cutoff_hz", 220.0),
                )
            )
            model_ids.append("dsp-band")
        else:  # pragma: no cover - programmer error
            raise ValueError(f"unknown cascade step kind {kind!r}")
        stem_sources[target_name] = (node_id, target_name)
        remainder = (node_id, rem_port)
    stem_sources[final_name] = remainder
    return stem_sources, model_ids


def _finish_cascade_plan(
    g: Graph,
    stem_sources: dict[str, tuple[str, str]],
    model_ids: list[str],
    notes: list[str],
    vram_lane: tuple[str, str],
    *,
    quality: str,
    with_residual: bool,
    bleed_suppress: bool,
    bleed_strength: float,
) -> SeparationPlan:
    g.add(GatherNode("separate", stem_sources))
    stem_ports = list(stem_sources)

    residual_node = None
    if with_residual:
        g.add(ResidualNode("residual", vram_lane, {name: ("separate", name) for name in stem_ports}))
        residual_node = "residual"

    bleed_node = None
    if bleed_suppress and len(stem_ports) >= 2:
        bleed_sources = {name: ("separate", name) for name in stem_ports}
        g.add(BleedSuppressNode("bleed", bleed_sources, strength=bleed_strength))
        bleed_node = "bleed"
        notes.append(
            f"bleed suppression applied (strength={bleed_strength:.2f}); "
            "pre-suppression stems remain available from 'separate' for A/B"
        )

    return SeparationPlan(
        graph=g,
        separate_node="separate",
        stem_ports=stem_ports,
        source_node=vram_lane[0],
        residual_node=residual_node,
        model_id="+".join(dict.fromkeys(model_ids)) if model_ids else "cascade",
        model_available=True,
        notes=notes,
        quality=quality,
        bleed_node=bleed_node,
    )


def _plan_detect_all(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    quality: str = "standard",
    auto_download: bool = True,
    progress=None,
    with_residual: bool = True,
    bleed_suppress: bool = True,
    bleed_strength: float = 0.6,
) -> SeparationPlan:
    """Detect-all cascade (roadmap §5.5): separate every asserted instrument,
    in confidence order, via cascaded extract-subtract; residual last."""
    notes: list[str] = []
    report = _quick_analysis(input_path)
    asserted = [h["instrument"] for h in report.instruments if h["status"] == "asserted"]
    order = [name for name in asserted if name in ("vocals", "drums", "bass")]
    if not order:
        order = ["vocals", "drums", "bass"]
        notes.append("no confidently-asserted instruments; using the default vocals/drums/bass order")
    else:
        notes.append("detect-all cascade order (by confidence): " + ", ".join(order))
    skipped = [name for name in asserted if name not in ("vocals", "drums", "bass")]
    if skipped:
        notes.append(
            "no dedicated separator for " + ", ".join(skipped) + " — folded into the 'other' stem"
        )

    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(LaneNode("lane", ("ingest", "audio"), 44100))
    lane = ("lane", "audio")

    joint_entry, _ = _resolve(registry, ["scnet", "htdemucs-ft"], notes, auto_download=auto_download, progress=progress)
    if joint_entry is not None and joint_entry.downloaded():
        sep = _apply_quality_tier(joint_entry.instantiate(), quality, notes)
        g.add(SeparateNode("cascade_joint", lane, sep, vram))
        base = getattr(sep, "inner", sep)
        stem_sources = {name: ("cascade_joint", name) for name in base.profile.stems}
        model_ids = [joint_entry.id]
        notes.append(f"using joint multi-stem model {joint_entry.id} instead of the DSP cascade")
    else:
        step_kind = {"vocals": "center", "drums": "hpss", "bass": "band"}
        step_params = {"vocals": {"prefer": PRESETS["vocals-best"]["prefer"]}, "drums": {}, "bass": {"cutoff_hz": 220.0}}
        steps = [(step_kind[name], name, step_params[name]) for name in order]
        stem_sources, model_ids = _build_extract_cascade(
            g, lane, steps, "other", registry, vram, notes,
            auto_download=auto_download, progress=progress, quality=quality,
        )

    return _finish_cascade_plan(
        g, stem_sources, model_ids, notes, lane,
        quality=quality, with_residual=with_residual,
        bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
    )


def _plan_cinematic(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    quality: str = "standard",
    auto_download: bool = True,
    progress=None,
    with_residual: bool = True,
    bleed_suppress: bool = True,
    bleed_strength: float = 0.6,
) -> SeparationPlan:
    """Cinematic cascade (roadmap §5.5): dialog / music / effects for video audio."""
    notes: list[str] = ["cinematic cascade: dialog (centre) -> fx (transients) -> music (remainder)"]
    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(LaneNode("lane", ("ingest", "audio"), 44100))
    lane = ("lane", "audio")

    steps = [
        ("center", "dialog", {"prefer": PRESETS["vocals-best"]["prefer"]}),
        ("hpss", "fx", {}),
    ]
    stem_sources, model_ids = _build_extract_cascade(
        g, lane, steps, "music", registry, vram, notes,
        auto_download=auto_download, progress=progress, quality=quality,
    )
    return _finish_cascade_plan(
        g, stem_sources, model_ids, notes, lane,
        quality=quality, with_residual=with_residual,
        bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
    )


def _plan_drums_deep_dive(
    input_path: str | Path,
    registry: Registry,
    vram: VRAMManager,
    *,
    quality: str = "reference",
    auto_download: bool = True,
    progress=None,
    with_residual: bool = True,
    bleed_suppress: bool = True,
    bleed_strength: float = 0.6,
) -> SeparationPlan:
    """Drums deep-dive (roadmap §5.5): a stems pass, then full kit decomposition."""
    from neiro.adapters.dsp_separators import DrumKitSeparator

    notes: list[str] = []
    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(LaneNode("lane", ("ingest", "audio"), 44100))
    lane = ("lane", "audio")

    joint_entry, _ = _resolve(registry, ["scnet", "htdemucs-ft"], notes, auto_download=auto_download, progress=progress)
    if joint_entry is not None and joint_entry.downloaded():
        stage1 = _apply_quality_tier(joint_entry.instantiate(), quality, notes)
        g.add(SeparateNode("stage1", lane, stage1, vram))
        base = getattr(stage1, "inner", stage1)
        drums_port = ("stage1", "drums")
        other_sources = {name: ("stage1", name) for name in base.profile.stems if name != "drums"}
        model_ids = [joint_entry.id]
    else:
        notes.append("no 4-stem model available; using the HPSS percussive proxy for the drums bus")
        g.add(CascadeHpssNode("stage1", lane, target_name="drums", complement_name="other"))
        drums_port = ("stage1", "drums")
        other_sources = {"other": ("stage1", "other")}
        model_ids = ["dsp-hpss"]

    kit_entry, _ = _resolve(registry, ["mdx23c-drumsep", "dsp-drumkit"], notes, auto_download=auto_download, progress=progress)
    kit_sep = _apply_quality_tier(
        kit_entry.instantiate() if kit_entry is not None else DrumKitSeparator(), quality, notes
    )
    g.add(SeparateNode("kit", drums_port, kit_sep, vram))
    kit_base = getattr(kit_sep, "inner", kit_sep)
    model_ids.append(kit_base.profile.model_id)

    stem_sources = {name: ("kit", name) for name in kit_base.profile.stems if name != "other"}
    if "other" in kit_base.profile.stems:
        stem_sources["drum_other"] = ("kit", "other")
    stem_sources.update(other_sources)

    return _finish_cascade_plan(
        g, stem_sources, model_ids, notes, lane,
        quality=quality, with_residual=with_residual,
        bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
    )


def plan_separation(
    input_path: str | Path,
    preset: str,
    registry: Registry,
    vram: VRAMManager,
    *,
    with_residual: bool = True,
    auto_download: bool = True,
    progress=None,
    quality: str | None = None,
    bleed_suppress: bool = True,
    bleed_strength: float = 0.6,
    auto_restore: bool = True,
) -> SeparationPlan:
    """Plan a separation job.

    ``quality`` overrides the preset's default tier (``draft`` / ``standard``
    / ``reference``, roadmap §5.2) — it changes overlap, TTA, and ensemble
    weighting (see :func:`_apply_quality_tier`). ``bleed_suppress`` runs the
    post-pass adaptive-gain bleed suppression of roadmap §5.3; it defaults on
    in every tier including Draft — set it to ``False`` explicitly for an A/B
    comparison, since it is never silently skipped otherwise.
    ``auto_restore`` lets a detected lossy-codec bandwidth ceiling
    auto-insert a restoration step before separation, but only using models
    already downloaded (never a surprise download, roadmap §6.2).

    ``detect-all``, ``cinematic``, and ``drums-deep-dive`` are cascades built
    by their own dedicated planners; every other preset resolves to a single
    (possibly ensemble) model as before.
    """
    if quality is not None and quality not in TIER_PARAMS:
        raise ValueError(f"unknown quality tier {quality!r}; expected one of {tuple(TIER_PARAMS)}")

    if preset == "detect-all":
        return _plan_detect_all(
            input_path, registry, vram, quality=quality or PRESETS[preset]["quality"],
            auto_download=auto_download, progress=progress, with_residual=with_residual,
            bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
        )
    if preset == "cinematic":
        return _plan_cinematic(
            input_path, registry, vram, quality=quality or PRESETS[preset]["quality"],
            auto_download=auto_download, progress=progress, with_residual=with_residual,
            bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
        )
    if preset == "drums-deep-dive":
        return _plan_drums_deep_dive(
            input_path, registry, vram, quality=quality or PRESETS[preset]["quality"],
            auto_download=auto_download, progress=progress, with_residual=with_residual,
            bleed_suppress=bleed_suppress, bleed_strength=bleed_strength,
        )

    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}; known: {', '.join(PRESETS)}")
    spec = PRESETS[preset]
    tier = quality or spec.get("quality", "standard")
    notes: list[str] = []

    prefer = list(spec.get("prefer", []))
    entry, _ = _resolve(registry, prefer, notes, auto_download=auto_download, progress=progress)
    if entry is None:
        # Nothing in the preference list is usable; fall back to any DSP model.
        entry = registry.best_for("separate", "draft", stems=spec["stems"])
        if entry is None:
            raise RuntimeError("no separation model available for this preset")
        notes.append(f"preferred models unavailable; using {entry.id}")

    separator = _apply_quality_tier(entry.instantiate(), tier, notes)

    g = Graph()
    g.add(IngestNode("ingest", input_path))
    intermediate: dict[str, tuple[str, str]] = {}
    lane_source = _maybe_prepend_restoration(
        g, ("ingest", "audio"), input_path, registry, vram, notes, intermediate, enabled=auto_restore
    )
    base_separator = getattr(separator, "inner", separator)
    g.add(LaneNode("lane", lane_source, base_separator.profile.sample_rate))
    g.add(SeparateNode("separate", ("lane", "audio"), separator, vram))

    stem_ports = list(base_separator.profile.stems)
    residual_node = None
    if with_residual:
        stems = {name: ("separate", name) for name in stem_ports}
        g.add(ResidualNode("residual", ("lane", "audio"), stems))
        residual_node = "residual"

    bleed_node = None
    if bleed_suppress and len(stem_ports) >= 2:
        bleed_sources = {name: ("separate", name) for name in stem_ports}
        g.add(BleedSuppressNode("bleed", bleed_sources, strength=bleed_strength))
        bleed_node = "bleed"
        notes.append(
            f"bleed suppression applied (strength={bleed_strength:.2f}); "
            "pre-suppression stems remain available from 'separate' for A/B"
        )

    if entry.license_spdx not in ("MIT", "Apache-2.0", "BSD-3-Clause", "builtin"):
        notes.append(
            f"model license: {entry.license_spdx} (see model provenance before commercial use)"
        )

    estimated_seconds = None
    duration = _probe_duration_seconds(input_path)
    if duration is not None:
        from neiro.engine.estimator import estimate_seconds

        device_kind = "cuda" if vram.has_accelerator else "cpu"
        estimated_seconds = estimate_seconds(entry.id, device_kind, duration, quality_class=tier)
        notes.append(f"estimated ~{estimated_seconds:.0f}s on this machine ({entry.id}, {device_kind})")

    return SeparationPlan(
        graph=g,
        separate_node="separate",
        stem_ports=stem_ports,
        source_node="lane",
        residual_node=residual_node,
        model_id=entry.id,
        model_available=entry.available(),
        notes=notes,
        quality=tier,
        bleed_node=bleed_node,
        estimated_seconds=estimated_seconds,
        intermediate=intermediate,
    )


@dataclass
class RestemPlan:
    """A single-stem re-separation job (roadmap §9.3 "swap a model" / item 8).

    Lets a caller re-run *one* stem with a different model than the one an
    earlier job used, without redoing ingest/analysis/the other stems. The
    content-addressed cache means the ingest/lane steps come back instantly
    if the same input was already processed in this session.
    """

    graph: Graph
    node_id: str
    stem_name: str
    model_id: str
    notes: list[str] = field(default_factory=list)


def plan_restem(
    input_path: str | Path,
    stem_name: str,
    model_id: str,
    registry: Registry,
    vram: VRAMManager,
    *,
    auto_download: bool = True,
    progress=None,
) -> RestemPlan:
    """Plan re-separating ``stem_name`` using ``model_id`` instead of whatever
    model originally produced it."""
    notes: list[str] = []
    try:
        entry = registry.get(model_id)
    except KeyError:
        raise ValueError(f"unknown model id {model_id!r}") from None
    if entry.task != "separate":
        raise ValueError(f"{model_id!r} is a {entry.task!r} model, not a separator")
    if not entry.available():
        raise RuntimeError(
            f"{model_id}: dependency not installed "
            f"(requires: {', '.join(entry.manifest.get('requires', [])) or 'unknown'})"
        )
    if entry.stems and stem_name not in entry.stems:
        raise ValueError(
            f"{model_id} does not produce a {stem_name!r} stem (produces: {', '.join(entry.stems)})"
        )
    if entry.needs_download and not entry.downloaded():
        if auto_download:
            notes.append(f"downloading {entry.id} weights (first use)")
            entry.ensure_downloaded(progress=progress)
        else:
            notes.append(f"{entry.id} weights not downloaded; run 'neiro download {entry.id}'")

    separator = entry.instantiate()
    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(LaneNode("lane", ("ingest", "audio"), separator.profile.sample_rate))
    g.add(SeparateNode("separate", ("lane", "audio"), separator, vram))

    return RestemPlan(graph=g, node_id="separate", stem_name=stem_name, model_id=entry.id, notes=notes)


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
# `restore`/`apollo`/`sonicmaster`/`deepfilternet` have no DSP fallback (there
# is no DSP equivalent of generative bandwidth restoration); like `dereverb`
# and `superres` they simply resolve to "no available model, skipped" until
# installed — the DSP-covered conditions (declip, declick, dehum, denoise,
# vocal-repair, normalize) always have a floor.
ENHANCE_STEPS: dict[str, list[str]] = {
    "declip": ["dsp-declip"],
    "declick": ["dsp-declick"],
    "dehum": ["dsp-dehum"],
    "denoise": ["denoise-roformer", "deepfilternet", "dsp-denoise"],
    "dereverb": ["dereverb-roformer"],
    "vocal-repair": ["dsp-vocal-repair"],
    "restore": ["apollo", "sonicmaster", "audiosr"],
    "superres": ["audiosr"],
    "apollo": ["apollo"],
    "sonicmaster": ["sonicmaster"],
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
        # download. Neural repair (dereverb/denoise/superres/restore) is powerful
        # but opt-in: detected conditions that a neural model would fix best are
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
            notes.append(
                "limited bandwidth — 'enhance --chain restore' (Apollo/SonicMaster) or "
                "'superres' (AudioSR) can extend it"
            )
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


@dataclass
class OrchestrationPlan:
    """Multi-instrument auto-split transcription (roadmap §8.1)."""

    graph: Graph
    compose_node: str
    instruments: list[str]
    stem_models: dict[str, str]
    mix_model_id: str | None
    notes: list[str] = field(default_factory=list)


def plan_orchestration(
    input_path: str | Path,
    instruments: list[str],
    registry: Registry,
    vram: VRAMManager,
    *,
    hybrid: bool = True,
    quantize: bool = True,
    division: int = 4,
    auto_download: bool = True,
    progress=None,
) -> OrchestrationPlan:
    """Plan a multi-instrument transcription: cascade separate -> per-stem decode
    -> hybrid merge with a full-mix decode -> one compiled :class:`Timeline`.

    For each requested instrument, the planner walks the separation registry to
    find (and chain, subtracting what's already claimed) the stem that carries
    it, then :mod:`neiro.symbolic.router` to pick a decoder for that stem. If no
    separator covers an instrument, it decodes straight from the original mix
    rather than failing the whole job. When ``hybrid`` is set and at least one
    stem decode succeeded, a full-mix decode is added too so
    :class:`~neiro.nodes.audio_nodes.OrchestrateComposeNode` can vote between
    them (roadmap §8.1 hybrid voting).
    """
    from neiro.symbolic.router import decoders_for

    notes: list[str] = []
    g = Graph()
    g.add(IngestNode("ingest", input_path))
    g.add(AnalyzeNode("analyze", ("ingest", "audio")))

    stem_names = {_stem_alias(i) for i in instruments}
    remaining = set(stem_names)
    stem_ports: dict[str, tuple[str, str]] = {}
    current_source: tuple[str, str] = ("ingest", "audio")
    order = {"draft": 0, "standard": 1, "reference": 2}
    step = 0

    while remaining:
        candidates = [
            e for e in registry.by_task("separate", only_available=True) if set(e.stems) & remaining
        ]
        if not candidates:
            break
        candidates.sort(key=lambda e: (-len(set(e.stems) & remaining), -order.get(e.quality_class, 1)))
        entry = candidates[0]
        if entry.needs_download and not entry.downloaded():
            if not auto_download:
                notes.append(f"{entry.id} not downloaded; stopping cascade there")
                break
            try:
                notes.append(f"downloading {entry.id} weights (first use)")
                entry.ensure_downloaded(progress=progress)
            except Exception as exc:  # pragma: no cover - network/dependency dependent
                notes.append(f"{entry.id}: download failed ({exc}); stopping cascade there")
                break

        separator = entry.instantiate()
        lane_id, sep_id = f"orch_lane_{step}", f"orch_sep_{step}"
        g.add(LaneNode(lane_id, current_source, separator.profile.sample_rate))
        g.add(SeparateNode(sep_id, (lane_id, "audio"), separator, vram))

        covered = set(entry.stems) & remaining
        for name in covered:
            stem_ports[name] = (sep_id, name)
        remaining -= covered
        notes.append(f"cascade: {entry.id} -> {', '.join(sorted(covered))}")

        if not remaining:
            break
        catch_all = next((s for s in ("other", "instrumental", "remainder") if s in entry.stems), None)
        if catch_all is None:
            notes.append("no catch-all stem to continue the cascade; remaining instruments decode from the full mix")
            break
        residual_id = f"orch_residual_{step}"
        others = {name: (sep_id, name) for name in entry.stems if name != catch_all}
        g.add(ResidualNode(residual_id, current_source, others))
        current_source = (residual_id, "residual")
        step += 1

    for name in remaining:
        notes.append(f"{name}: no separator covers it; decoding from the full mix")
        stem_ports[name] = ("ingest", "audio")

    stem_stream_ports: dict[str, tuple[str, str]] = {}
    model_ids: dict[str, str] = {}
    for i, instrument in enumerate(instruments):
        stem_name = _stem_alias(instrument)
        source_port = stem_ports.get(stem_name, ("ingest", "audio"))
        entry = None
        for model_id in decoders_for(instrument):
            try:
                candidate = registry.get(model_id)
            except KeyError:
                continue
            if not candidate.available():
                continue
            if candidate.needs_download and not candidate.downloaded():
                if not auto_download:
                    continue
                try:
                    candidate.ensure_downloaded(progress=progress)
                except Exception as exc:  # pragma: no cover
                    notes.append(f"{candidate.id}: download failed ({exc}); trying next decoder")
                    continue
            entry = candidate
            break
        if entry is None:
            notes.append(f"{instrument}: no decoder available")
            continue

        transcriber = entry.instantiate()
        lane_id, dec_id = f"orch_declane_{i}", f"orch_decode_{i}"
        g.add(LaneNode(lane_id, source_port, transcriber.profile.sample_rate or 16000, mono=True))
        g.add(TranscribeNode(dec_id, (lane_id, "audio"), transcriber, vram))
        stem_stream_ports[instrument] = (dec_id, "notes")
        model_ids[instrument] = entry.id
        notes.append(f"{instrument}: decoding with {entry.id}")

    mix_stream_port = None
    mix_model_id = None
    if hybrid and stem_stream_ports:
        mix_entry, _ = _resolve(
            registry,
            ["multi-instrument", "basic-pitch", "dsp-yin"],
            notes,
            auto_download=auto_download,
            progress=progress,
        )
        if mix_entry is not None:
            mix_transcriber = mix_entry.instantiate()
            g.add(LaneNode("orch_mixlane", ("ingest", "audio"), mix_transcriber.profile.sample_rate or 16000, mono=True))
            g.add(TranscribeNode("orch_mixdecode", ("orch_mixlane", "audio"), mix_transcriber, vram))
            mix_stream_port = ("orch_mixdecode", "notes")
            mix_model_id = mix_entry.id
            notes.append(f"hybrid voting: full-mix decode via {mix_entry.id}")

    if not stem_stream_ports:
        raise RuntimeError("no decoder was available for any requested instrument")

    g.add(
        OrchestrateComposeNode(
            "compose",
            stem_stream_ports,
            model_ids,
            mix_stream=mix_stream_port,
            mix_model_id=mix_model_id,
            report=("analyze", "report"),
            quantize=quantize,
            division=division,
        )
    )

    return OrchestrationPlan(
        graph=g,
        compose_node="compose",
        instruments=list(instruments),
        stem_models=model_ids,
        mix_model_id=mix_model_id,
        notes=notes,
    )


def _stem_alias(instrument: str) -> str:
    from neiro.symbolic.orchestrate import normalize_instrument

    return normalize_instrument(instrument)
