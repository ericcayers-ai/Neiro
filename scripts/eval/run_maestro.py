#!/usr/bin/env python
"""Benchmark piano transcription against a user-provisioned MAESTRO checkout.

Requires ``NEIRO_EVAL_MAESTRO=/path/to/maestro`` (v2/v3 layout: a
``maestro-v*.csv`` metadata file alongside year-numbered audio/MIDI folders).
MAESTRO is not bundled or downloaded by this repo — see ``docs/evaluation.md``.

If the dataset isn't configured, this exits **0** with an explanatory message
(a "skip", not a failure) so CI never depends on data nobody has agreed to
download.

By default uses the DSP floor (``dsp-yin``) with ``--auto-download`` opting into
neural models such as ``piano-transcription`` / ``basic-pitch``. Scores are
mir_eval-style note-level F1 (:func:`neiro.eval.metrics.note_f1`) against the
ground-truth MIDI for each performance.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

from neiro.eval import metrics
from neiro.eval.datasets import locate_maestro
from neiro.eval.midi_reader import read_midi_notes


def _find_metadata_csv(root: Path) -> Path | None:
    candidates = sorted(root.glob("maestro-v*.csv"))
    return candidates[0] if candidates else None


def _iter_rows(csv_path: Path, split: str, limit: int) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    # MAESTRO CSV uses either "split" or "year"+"canonical_composer"; prefer "split".
    filtered = [r for r in rows if r.get("split", "").strip().lower() == split.lower()]
    if not filtered and split == "test":
        # Older/malformed CSV without split — take everything as "evaluation subset"
        # but still honour --limit so a developer can smoke-test without enumerating
        # the whole corpus.
        filtered = rows
    return filtered[:limit] if limit > 0 else filtered


def _evaluate_row(
    root: Path,
    row: dict[str, str],
    *,
    model: str | None,
    auto_download: bool,
) -> dict[str, Any]:
    from neiro.engine.cache import ArtifactCache
    from neiro.engine.graph import ExecutionContext
    from neiro.engine.planner import plan_transcription
    from neiro.engine.registry import default_registry
    from neiro.engine.vram import VRAMManager

    audio_rel = row.get("audio_filename") or row.get("audio_file")
    midi_rel = row.get("midi_filename") or row.get("midi_file")
    if not audio_rel or not midi_rel:
        return {"error": "row missing audio_filename / midi_filename"}

    audio_path = root / audio_rel
    midi_path = root / midi_rel
    if not audio_path.exists():
        return {"audio": audio_rel, "error": f"audio not found: {audio_path}"}
    if not midi_path.exists():
        return {"audio": audio_rel, "error": f"midi not found: {midi_path}"}

    ref_notes = list(read_midi_notes(midi_path))
    registry = default_registry()
    vram = VRAMManager()
    plan = plan_transcription(
        audio_path,
        registry,
        vram,
        mode="direct",  # MAESTRO is solo piano — split path would only hurt
        quantize=False,  # score against absolute onsets, not a quantized grid
        model=model,
        auto_download=auto_download,
    )
    ctx = ExecutionContext(cache=ArtifactCache())
    outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
    timeline = outputs[plan.compile_node]["timeline"]
    pred_notes = [e for _name, stream in timeline.tracks for e in stream.events]

    result = metrics.note_f1(pred_notes, ref_notes)
    return {
        "audio": audio_rel,
        "midi": midi_rel,
        "model_id": plan.model_id,
        "notes_predicted": len(pred_notes),
        "notes_reference": len(ref_notes),
        **result.as_dict(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--split", default="test", choices=("train", "validation", "test"))
    parser.add_argument(
        "--model",
        default="dsp-yin",
        help="transcription model id (default: dsp-yin = no weight download; "
        "use piano-transcription / basic-pitch with --auto-download for neural)",
    )
    parser.add_argument("--limit", type=int, default=3, help="max performances (0 = all)")
    parser.add_argument(
        "--auto-download",
        action="store_true",
        help="allow downloading model weights (off by default)",
    )
    parser.add_argument("--json", metavar="PATH", default=None)
    args = parser.parse_args(argv)

    status = locate_maestro()
    print(status.message)
    if not status.available:
        return 0  # skip, not a failure

    csv_path = _find_metadata_csv(status.path)
    if csv_path is None:
        print(
            f"No maestro-v*.csv found under {status.path} — "
            "expected a MAESTRO v2/v3-style root. See docs/evaluation.md."
        )
        return 0

    rows = _iter_rows(csv_path, args.split, args.limit)
    if not rows:
        print(f"No rows for split={args.split!r} in {csv_path.name}")
        return 0

    model = None if args.model in ("", "auto") else args.model
    report: dict[str, Any] = {
        "dataset": "maestro",
        "split": args.split,
        "model": model or "auto",
        "performances": [],
    }
    for row in rows:
        label = row.get("canonical_title") or row.get("audio_filename") or "?"
        print(f"Evaluating {label} ...")
        try:
            result = _evaluate_row(status.path, row, model=model, auto_download=args.auto_download)
        except Exception as exc:
            result = {"error": str(exc), "audio": row.get("audio_filename")}
        report["performances"].append(result)
        if "error" in result:
            print(f"  ERROR: {result['error']}")
        else:
            print(
                f"  F1={result['f1']:.3f} P={result['precision']:.3f} "
                f"R={result['recall']:.3f} ({result['backend']}; "
                f"pred={result['notes_predicted']} ref={result['notes_reference']})"
            )

    f1s = [p["f1"] for p in report["performances"] if "f1" in p]
    report["mean_f1"] = round(sum(f1s) / len(f1s), 4) if f1s else None
    print(f"\nMean F1: {report['mean_f1']}")

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
