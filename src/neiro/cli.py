"""Neiro command-line interface.

    neiro analyze    <file>
    neiro separate   <file> [--preset vocals|vocals-ensemble|harmonic|4stem] [--out DIR]
    neiro transcribe <file> [--mode auto|direct|split] [--out FILE.mid] [--no-quantize]
    neiro enhance    <file> [--chain declip,dehum,denoise,normalize] [--out FILE]
    neiro models     [list]
    neiro ui         [--port N] [--no-browser]

The CLI is a thin client over the same engine the GUI uses (roadmap §2.1): it
builds a plan through the planner, runs the graph, and writes artifacts. Progress
is printed as real stage names, not a fake percentage bar.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from neiro import __version__
from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import ExecutionContext, Progress
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager


def _progress_printer(quiet: bool):
    def _p(prog: Progress) -> None:
        if quiet:
            return
        print(f"  [{prog.node_id}] {prog.stage}: {prog.message}", file=sys.stderr)

    return _p


def cmd_analyze(args: argparse.Namespace) -> int:
    from neiro.analysis import analyze
    from neiro.io import load_audio

    audio = load_audio(args.input)
    report = analyze(audio)
    print(json.dumps(report.as_dict(), indent=2))
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    reg = default_registry()
    entries = reg.all()
    if not entries:
        print("No models registered.")
        return 0
    width = max(len(e.id) for e in entries)
    print(f"{'MODEL':<{width}}  {'TASK':<10} {'QUALITY':<10} {'LICENSE':<12} AVAILABLE  STEMS")
    for e in sorted(entries, key=lambda x: (x.task, x.id)):
        avail = "yes" if e.available() else "no"
        print(
            f"{e.id:<{width}}  {e.task:<10} {e.quality_class:<10} "
            f"{e.license_spdx:<12} {avail:<9} {', '.join(e.stems)}"
        )
    return 0


def cmd_separate(args: argparse.Namespace) -> int:
    from neiro.engine.planner import plan_separation
    from neiro.io import write_audio

    registry = default_registry()
    vram = VRAMManager()
    plan = plan_separation(args.input, args.preset, registry, vram)

    print(f"Model: {plan.model_id}", file=sys.stderr)
    for note in plan.notes:
        print(f"Note: {note}", file=sys.stderr)

    ctx = ExecutionContext(cache=ArtifactCache(), progress=_progress_printer(args.quiet))
    outputs = plan.graph.execute(ctx, targets=[plan.residual_node or plan.separate_node])

    out_dir = Path(args.out) if args.out else Path(args.input).with_suffix("")
    out_dir = out_dir if out_dir.is_absolute() else Path.cwd() / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stem_outputs = outputs[plan.separate_node]
    written = []
    stem_arrays = []
    for name, art in stem_outputs.items():
        path = out_dir / f"{name}.{args.format}"
        write_audio(art, path, fmt=args.format, bit_depth=args.bit_depth)
        written.append(path)
        stem_arrays.append(art)

    if plan.residual_node:
        resid = outputs[plan.residual_node]["residual"]
        path = out_dir / f"residual.{args.format}"
        write_audio(resid, path, fmt=args.format, bit_depth=args.bit_depth)
        written.append(path)
        # Null-test figure: residual loudness relative to source.
        print(
            f"Null test: residual peak {20 * np.log10(resid.peak() + 1e-12):.1f} dBFS "
            f"(lower = more of the mix accounted for)",
            file=sys.stderr,
        )

    print(f"Wrote {len(written)} files to {out_dir}:")
    for p in written:
        print(f"  {p.name}")
    return 0


def cmd_transcribe(args: argparse.Namespace) -> int:
    from neiro.engine.planner import plan_transcription
    from neiro.symbolic import write_midi

    registry = default_registry()
    vram = VRAMManager()
    plan = plan_transcription(
        args.input,
        registry,
        vram,
        mode=args.mode,
        quantize=not args.no_quantize,
        division=args.division,
    )
    print(
        f"Model: {plan.model_id}" + (" (with auto-split)" if plan.used_split else ""),
        file=sys.stderr,
    )
    for note in plan.notes:
        print(f"Note: {note}", file=sys.stderr)

    ctx = ExecutionContext(cache=ArtifactCache(), progress=_progress_printer(args.quiet))
    outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
    timeline = outputs[plan.compile_node]["timeline"]

    out_path = Path(args.out) if args.out else Path(args.input).with_suffix(".mid")
    write_midi(timeline, out_path)

    n = timeline.total_events()
    print(f"Transcribed {n} notes at {timeline.tempo_bpm:.1f} BPM -> {out_path}")
    if n == 0:
        print(
            "No notes found — the source may be unpitched, too dense, or too quiet.",
            file=sys.stderr,
        )
    if args.json:
        payload = {
            "tempo_bpm": timeline.tempo_bpm,
            "tracks": {
                name: [
                    {
                        "onset": e.onset,
                        "offset": e.offset,
                        "pitch": e.pitch,
                        "velocity": e.velocity,
                        "confidence": e.confidence,
                    }
                    for e in stream.events
                ]
                for name, stream in timeline.tracks
            },
        }
        print(json.dumps(payload, indent=2))
    return 0


def cmd_enhance(args: argparse.Namespace) -> int:
    from neiro.engine.planner import plan_enhancement
    from neiro.io import write_audio

    registry = default_registry()
    vram = VRAMManager()
    chain = args.chain.split(",") if args.chain else None
    plan = plan_enhancement(args.input, registry, vram, chain=chain)
    for note in plan.notes:
        print(f"Note: {note}", file=sys.stderr)
    if not plan.chain:
        print("Nothing to repair; output would equal input. No file written.")
        return 0
    print(f"Chain: {' -> '.join(plan.chain)}", file=sys.stderr)

    ctx = ExecutionContext(cache=ArtifactCache(), progress=_progress_printer(args.quiet))
    outputs = plan.graph.execute(ctx, targets=[plan.output_node])
    audio = outputs[plan.output_node]["audio"]

    src = Path(args.input)
    out_path = Path(args.out) if args.out else src.with_name(f"{src.stem}.restored.wav")
    fmt = "flac" if out_path.suffix.lower() == ".flac" else "wav"
    write_audio(audio, out_path, fmt=fmt, bit_depth=args.bit_depth)
    print(f"Wrote {out_path}")
    return 0


def cmd_ui(args: argparse.Namespace) -> int:
    from neiro.ui.server import serve

    return serve(port=args.port, open_browser=not args.no_browser)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="neiro", description=__doc__)
    parser.add_argument("--version", action="version", version=f"neiro {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_an = sub.add_parser("analyze", help="analyze a file and print its report as JSON")
    p_an.add_argument("input")
    p_an.set_defaults(func=cmd_analyze)

    p_sep = sub.add_parser("separate", help="separate a file into stems")
    p_sep.add_argument("input")
    p_sep.add_argument(
        "--preset",
        default="vocals",
        choices=["vocals", "vocals-ensemble", "harmonic", "4stem"],
    )
    p_sep.add_argument("--out", default=None, help="output directory (default: <input name>/)")
    p_sep.add_argument("--format", default="wav", choices=["wav", "flac"])
    p_sep.add_argument("--bit-depth", type=int, default=24, choices=[16, 24, 32])
    p_sep.add_argument("--quiet", action="store_true")
    p_sep.set_defaults(func=cmd_separate)

    p_tr = sub.add_parser("transcribe", help="transcribe a file to MIDI")
    p_tr.add_argument("input")
    p_tr.add_argument("--mode", default="auto", choices=["auto", "direct", "split"])
    p_tr.add_argument("--out", default=None, help="output MIDI path (default: <input>.mid)")
    p_tr.add_argument("--no-quantize", action="store_true", help="keep free (performance) timing")
    p_tr.add_argument(
        "--division", type=int, default=4, help="grid cells per beat (default 4 = 16ths)"
    )
    p_tr.add_argument("--json", action="store_true", help="also print the timeline as JSON")
    p_tr.add_argument("--quiet", action="store_true")
    p_tr.set_defaults(func=cmd_transcribe)

    p_en = sub.add_parser("enhance", help="repair/restore a file")
    p_en.add_argument("input")
    p_en.add_argument(
        "--chain",
        default=None,
        help="comma-separated steps (declip,dehum,denoise,normalize); default: auto from analysis",
    )
    p_en.add_argument("--out", default=None, help="output path (default: <input>.restored.wav)")
    p_en.add_argument("--bit-depth", type=int, default=24, choices=[16, 24, 32])
    p_en.add_argument("--quiet", action="store_true")
    p_en.set_defaults(func=cmd_enhance)

    p_mod = sub.add_parser("models", help="list registered models")
    p_mod.add_argument("action", nargs="?", default="list", choices=["list"])
    p_mod.set_defaults(func=cmd_models)

    p_ui = sub.add_parser("ui", help="open the local interface in a browser")
    p_ui.add_argument("--port", type=int, default=8377)
    p_ui.add_argument("--no-browser", action="store_true")
    p_ui.set_defaults(func=cmd_ui)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
