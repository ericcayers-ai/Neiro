#!/usr/bin/env python
"""Benchmark separation against a user-provisioned MUSDB18-HQ checkout.

Requires ``NEIRO_EVAL_MUSDB=/path/to/MUSDB18-HQ`` (standard layout: ``train/``
and ``test/``, each with one folder per track containing ``mixture.wav`` and
per-stem ``.wav`` files). MUSDB18-HQ is not bundled or downloaded by this repo
— see ``docs/evaluation.md`` for where to get it.

If the dataset isn't configured, this exits **0** with an explanatory message
— it is a "skip", not a failure, so it's safe to always list in CI without
gating anything on data nobody has agreed to download.

By default no model weights are downloaded (``--auto-download`` opts in); the
real engine planner (:func:`neiro.engine.planner.plan_separation`) picks the
best model you already have locally for the chosen ``--preset``, falling back
to the DSP floor (``dsp-center`` / ``scnet`` unavailable, etc.) exactly like
the CLI does — so this reports what a real user of your current install would
actually get, not just a synthetic-corpus number.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from neiro.eval import metrics
from neiro.eval.datasets import locate_musdb

STEM_FILES = ("vocals", "drums", "bass", "other")


def _iter_tracks(root: Path, split: str, limit: int) -> list[Path]:
    split_dir = root / split
    if not split_dir.is_dir():
        raise FileNotFoundError(f"{split_dir} does not exist (expected a {split!r} split folder)")
    tracks = sorted(p for p in split_dir.iterdir() if p.is_dir())
    return tracks[:limit] if limit > 0 else tracks


def _evaluate_track(track_dir: Path, preset: str, auto_download: bool) -> dict[str, Any]:
    from neiro.engine.cache import ArtifactCache
    from neiro.engine.graph import ExecutionContext
    from neiro.engine.planner import plan_separation
    from neiro.engine.registry import default_registry
    from neiro.engine.vram import VRAMManager
    from neiro.io import load_audio

    mixture_path = track_dir / "mixture.wav"
    if not mixture_path.exists():
        return {"track": track_dir.name, "error": "no mixture.wav"}

    references: dict[str, np.ndarray] = {}
    for stem in STEM_FILES:
        stem_path = track_dir / f"{stem}.wav"
        if stem_path.exists():
            references[stem] = load_audio(stem_path).samples

    registry = default_registry()
    vram = VRAMManager()
    plan = plan_separation(
        mixture_path,
        preset,
        registry,
        vram,
        auto_download=auto_download,
        with_residual=False,
        # Eval must never surprise-download a restoration model, and bleed
        # suppression changes the stem the metric is scored against — keep both
        # off so the reported SDR is attributable to the separator alone.
        auto_restore=False,
        bleed_suppress=False,
    )
    ctx = ExecutionContext(cache=ArtifactCache())
    outputs = plan.graph.execute(ctx, targets=[plan.separate_node])
    stems = outputs[plan.separate_node]

    result: dict[str, Any] = {"track": track_dir.name, "model_id": plan.model_id, "stems": {}}
    for name, estimate in stems.items():
        ref = references.get(name)
        if ref is None:
            continue
        rivals = [arr for stem_name, arr in references.items() if stem_name != name]
        result["stems"][name] = {
            "sdr_db": round(metrics.sdr(estimate.samples, ref), 2),
            "si_sdr_db": round(metrics.si_sdr(estimate.samples, ref), 2),
            "bleed_db": round(metrics.bleed_db(estimate.samples, rivals), 2) if rivals else None,
        }
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--split", default="test", choices=("train", "test"))
    parser.add_argument(
        "--preset",
        default="vocals",
        help=(
            "separation preset from neiro.engine.planner.PRESETS "
            "(default: vocals = dsp-center floor, no weight download; "
            "use 4stem/vocals-best with --auto-download for neural benches)"
        ),
    )
    parser.add_argument("--limit", type=int, default=5, help="max tracks to evaluate (0 = all)")
    parser.add_argument(
        "--auto-download",
        action="store_true",
        help="allow downloading model weights (off by default; use local/DSP models only)",
    )
    parser.add_argument("--json", metavar="PATH", default=None, help="write the report as JSON ('-' for stdout)")
    args = parser.parse_args(argv)

    status = locate_musdb()
    print(status.message)
    if not status.available:
        return 0  # skip, not a failure — see module docstring

    tracks = _iter_tracks(status.path, args.split, args.limit)
    if not tracks:
        print(f"No track folders found under {status.path / args.split}")
        return 0

    report: dict[str, Any] = {"dataset": "musdb18hq", "split": args.split, "preset": args.preset, "tracks": []}
    for track_dir in tracks:
        print(f"Evaluating {track_dir.name} ...")
        try:
            result = _evaluate_track(track_dir, args.preset, args.auto_download)
        except Exception as exc:  # a bad track shouldn't kill the whole run
            result = {"track": track_dir.name, "error": str(exc)}
        report["tracks"].append(result)
        if "error" in result:
            print(f"  ERROR: {result['error']}")
        else:
            for stem, m in result["stems"].items():
                print(f"  {stem}: SDR={m['sdr_db']}dB SI-SDR={m['si_sdr_db']}dB bleed={m['bleed_db']}dB")

    per_stem_sdr: dict[str, list[float]] = {}
    for result in report["tracks"]:
        for stem, m in result.get("stems", {}).items():
            per_stem_sdr.setdefault(stem, []).append(m["sdr_db"])
    report["mean_sdr_db"] = {stem: round(sum(v) / len(v), 2) for stem, v in per_stem_sdr.items() if v}

    print("\nMean SDR by stem:")
    for stem, mean in report["mean_sdr_db"].items():
        print(f"  {stem}: {mean} dB")

    if args.json:
        payload = json.dumps(report, indent=2)
        if args.json == "-":
            print(payload)
        else:
            Path(args.json).write_text(payload, encoding="utf-8")
            print(f"\nWrote {args.json}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
