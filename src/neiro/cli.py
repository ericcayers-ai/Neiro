"""Neiro command-line interface.

    neiro analyze    <file|url>
    neiro ingest     <url> [--out FILE]
    neiro separate   <file|url> [--preset vocals-best|karaoke|4stem|6stem|drums|...] [--out DIR]
    neiro transcribe <file|url> [--mode auto|direct|split] [--model ID] [--out FILE.mid]
    neiro enhance    <file|url> [--chain declip,dehum,denoise,dereverb,superres,master] [--out FILE]
    neiro models     [list]
    neiro download   <model-id|--all|--task TASK>
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


def _resolve_input_arg(path_or_url: str, *, quiet: bool = False) -> str:
    """Local path, or fetch a URL to cache first."""
    from neiro.io.url_ingest import is_url, resolve_input

    if not is_url(path_or_url):
        return path_or_url
    if not quiet:
        print(f"Fetching audio from {path_or_url} …", file=sys.stderr)
    local = resolve_input(path_or_url)
    if not quiet:
        print(f"Using {local}", file=sys.stderr)
    return str(local)


def _download_printer(quiet: bool):
    """Progress callback for model downloads triggered during planning."""
    last = {"v": -1}

    def _p(prog) -> None:  # DownloadProgress
        if quiet:
            return
        frac = getattr(prog, "fraction", None)
        if frac is not None:
            pct = int(frac * 100)
            if pct != last["v"]:
                last["v"] = pct
                mb = prog.downloaded_bytes / 1e6
                print(
                    f"\r  downloading {prog.model_id}: {pct}% ({mb:.0f} MB)",
                    end="" if prog.stage != "done" else "\n",
                    file=sys.stderr,
                )
        elif prog.stage == "done":
            print(f"\r  downloaded {prog.model_id}" + " " * 20, file=sys.stderr)

    return _p


def cmd_ingest(args: argparse.Namespace) -> int:
    import shutil

    from neiro.io.url_ingest import fetch_url_audio, is_url

    if not is_url(args.url):
        raise ValueError("ingest requires an http(s) URL")
    path = fetch_url_audio(args.url, force=args.force)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, out)
        path = out
    print(path)
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    from neiro.analysis import analyze
    from neiro.io import load_audio

    audio = load_audio(_resolve_input_arg(args.input, quiet=args.quiet))
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
    header = (
        f"{'MODEL':<{width}}  {'TASK':<10} {'QUALITY':<10} {'LICENSE':<12} "
        f"{'AVAIL':<6} {'DOWNL':<6} STEMS"
    )
    print(header)
    for e in sorted(entries, key=lambda x: (x.task, x.id)):
        avail = "yes" if e.available() else "no"
        try:
            downl = "yes" if e.downloaded() else "no"
        except Exception:
            downl = "?"
        print(
            f"{e.id:<{width}}  {e.task:<10} {e.quality_class:<10} "
            f"{e.license_spdx:<12} {avail:<6} {downl:<6} {', '.join(e.stems)}"
        )
    print(
        "\nAVAIL = Python dependency installed · DOWNL = weights present locally.\n"
        "Fetch weights with: neiro download <model-id>   (or --all / --task separate)",
        file=sys.stderr,
    )
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    from neiro.engine.downloader import DownloadProgress

    reg = default_registry()

    if args.all:
        targets = [e for e in reg.all() if e.available() and e.needs_download]
    elif args.task:
        targets = [e for e in reg.by_task(args.task) if e.available() and e.needs_download]
    elif args.model_id:
        try:
            targets = [reg.get(args.model_id)]
        except KeyError:
            print(f"error: unknown model {args.model_id!r}", file=sys.stderr)
            return 1
    else:
        print("error: specify a model id, --all, or --task TASK", file=sys.stderr)
        return 1

    if not targets:
        print("Nothing to download (already present, or no matching available models).")
        return 0

    last_pct = {"v": -1}

    def _prog(p: DownloadProgress) -> None:
        if args.quiet:
            return
        frac = p.fraction
        if frac is not None:
            pct = int(frac * 100)
            if pct != last_pct["v"]:
                last_pct["v"] = pct
                mb = p.downloaded_bytes / 1e6
                print(f"\r  {p.model_id}: {p.stage} {pct}% ({mb:.0f} MB)", end="", file=sys.stderr)
        else:
            print(f"\r  {p.model_id}: {p.stage}...", end="", file=sys.stderr)

    failed = 0
    for e in targets:
        if e.downloaded():
            print(f"{e.id}: already downloaded")
            continue
        if not e.available():
            print(
                f"{e.id}: skipped (dependency not installed: "
                f"{', '.join(e.manifest.get('requires', [])) or 'unknown'})"
            )
            continue
        if e.license_spdx in ("unknown", "GPL-3.0") or e.license_note:
            print(
                f"{e.id}: license {e.license_spdx} — {e.license_note or 'verify terms before use'}"
            )
        last_pct["v"] = -1
        try:
            e.ensure_downloaded(progress=_prog)
            print(f"\r{e.id}: downloaded" + " " * 30)
        except Exception as exc:
            failed += 1
            print(f"\r{e.id}: FAILED — {exc}" + " " * 20, file=sys.stderr)

    return 1 if failed else 0


def cmd_separate(args: argparse.Namespace) -> int:
    from neiro.engine.planner import plan_separation
    from neiro.io import write_audio, write_export_metadata

    registry = default_registry()
    vram = VRAMManager()
    input_path = _resolve_input_arg(args.input, quiet=args.quiet)
    plan = plan_separation(
        input_path,
        args.preset,
        registry,
        vram,
        auto_download=not args.no_download,
        progress=_download_printer(args.quiet),
    )
    entry = registry.get(plan.model_id)

    print(f"Model: {plan.model_id}", file=sys.stderr)
    for note in plan.notes:
        print(f"Note: {note}", file=sys.stderr)

    ctx = ExecutionContext(cache=ArtifactCache(), progress=_progress_printer(args.quiet))
    outputs = plan.graph.execute(ctx, targets=[plan.residual_node or plan.separate_node])

    out_dir = Path(args.out) if args.out else Path(input_path).with_suffix("")
    out_dir = out_dir if out_dir.is_absolute() else Path.cwd() / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stem_outputs = outputs[plan.separate_node]
    written = []
    stem_arrays = []
    for name, art in stem_outputs.items():
        path = out_dir / f"{name}.{args.format}"
        write_audio(art, path, fmt=args.format, bit_depth=args.bit_depth)
        write_export_metadata(
            path,
            model_id=plan.model_id,
            license_spdx=entry.license_spdx,
            license_note=entry.license_note,
            provenance=art.provenance,
        )
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
    input_path = _resolve_input_arg(args.input, quiet=args.quiet)
    plan = plan_transcription(
        input_path,
        registry,
        vram,
        mode=args.mode,
        quantize=not args.no_quantize,
        division=args.division,
        model=args.model,
        auto_download=not args.no_download,
        progress=_download_printer(args.quiet),
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

    out_path = Path(args.out) if args.out else Path(input_path).with_suffix(".mid")
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
    input_path = _resolve_input_arg(args.input, quiet=args.quiet)
    plan = plan_enhancement(
        input_path,
        registry,
        vram,
        chain=chain,
        auto_download=not args.no_download,
        progress=_download_printer(args.quiet),
        reference_path=args.reference,
    )
    for note in plan.notes:
        print(f"Note: {note}", file=sys.stderr)
    if not plan.chain:
        print("Nothing to repair; output would equal input. No file written.")
        return 0
    print(f"Chain: {' -> '.join(plan.chain)}", file=sys.stderr)

    ctx = ExecutionContext(cache=ArtifactCache(), progress=_progress_printer(args.quiet))
    outputs = plan.graph.execute(ctx, targets=[plan.output_node])
    audio = outputs[plan.output_node]["audio"]

    src = Path(input_path)
    out_path = Path(args.out) if args.out else src.with_name(f"{src.stem}.restored.wav")
    fmt = "flac" if out_path.suffix.lower() == ".flac" else "wav"
    write_audio(audio, out_path, fmt=fmt, bit_depth=args.bit_depth)
    print(f"Wrote {out_path}")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    from neiro.io.watch import watch_loop

    return watch_loop(
        Path(args.inbox),
        Path(args.out),
        job=args.job,
        preset=args.preset,
        poll_seconds=args.poll,
        quiet=args.quiet,
        once=args.once,
    )


def cmd_ui(args: argparse.Namespace) -> int:
    from neiro.ui.server import serve

    return serve(port=args.port, open_browser=not args.no_browser, ws_port=args.ws_port)


def cmd_session_save(args: argparse.Namespace) -> int:
    from neiro.engine.session import SessionDocument, SessionStore, file_fingerprint

    home = Path(args.home) if args.home else None
    store = SessionStore(home / "sessions" if home else None)
    source_path = Path(args.input)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)

    name = args.name or source_path.stem
    graph_config: dict = {}
    if args.preset:
        graph_config["preset"] = args.preset
    if args.job:
        graph_config["job"] = args.job

    doc = SessionDocument(
        name=name,
        source=file_fingerprint(source_path),
        graph_config=graph_config,
        notes=[f"created by 'neiro session save' from {source_path.name}"],
    )
    path = store.save(doc, name=name)
    print(f"Saved session '{name}' -> {path}")
    return 0


def cmd_session_load(args: argparse.Namespace) -> int:
    from neiro.engine.session import SessionStore

    home = Path(args.home) if args.home else None
    store = SessionStore(home / "sessions" if home else None)
    doc = store.load(args.name)
    print(json.dumps(doc.to_dict(), indent=2))
    return 0


def cmd_session_list(args: argparse.Namespace) -> int:
    from neiro.engine.session import SessionStore

    home = Path(args.home) if args.home else None
    store = SessionStore(home / "sessions" if home else None)
    paths = store.list_sessions()
    if not paths:
        print("No sessions saved.")
        return 0
    for p in paths:
        print(p.stem.removesuffix(".neiro"))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="neiro", description=__doc__)
    parser.add_argument("--version", action="version", version=f"neiro {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_an = sub.add_parser("analyze", help="analyze a file or URL and print its report as JSON")
    p_an.add_argument("input")
    p_an.add_argument("--quiet", action="store_true")
    p_an.set_defaults(func=cmd_analyze)

    p_ing = sub.add_parser("ingest", help="download audio from a URL (YouTube, etc.)")
    p_ing.add_argument("url")
    p_ing.add_argument("--out", default=None, help="copy downloaded audio to this path")
    p_ing.add_argument("--force", action="store_true", help="re-download even if cached")
    p_ing.set_defaults(func=cmd_ingest)

    sep_presets = [
        "vocals",
        "vocals-ensemble",
        "vocals-neural-ensemble",
        "vocals-best",
        "karaoke",
        "harmonic",
        "4stem",
        "6stem",
        "drums",
        "detect-all",
        "cinematic",
    ]
    p_sep = sub.add_parser("separate", help="separate a file into stems")
    p_sep.add_argument("input")
    p_sep.add_argument("--preset", default="vocals", choices=sep_presets)
    p_sep.add_argument("--out", default=None, help="output directory (default: <input name>/)")
    p_sep.add_argument("--format", default="wav", choices=["wav", "flac"])
    p_sep.add_argument("--bit-depth", type=int, default=24, choices=[16, 24, 32])
    p_sep.add_argument(
        "--no-download",
        action="store_true",
        help="don't fetch neural weights; use the best already-available model",
    )
    p_sep.add_argument("--quiet", action="store_true")
    p_sep.set_defaults(func=cmd_separate)

    p_tr = sub.add_parser("transcribe", help="transcribe a file to MIDI")
    p_tr.add_argument("input")
    p_tr.add_argument("--mode", default="auto", choices=["auto", "direct", "split"])
    p_tr.add_argument(
        "--model", default=None, help="force a transcriber id (e.g. piano-transcription)"
    )
    p_tr.add_argument("--out", default=None, help="output MIDI path (default: <input>.mid)")
    p_tr.add_argument("--no-quantize", action="store_true", help="keep free (performance) timing")
    p_tr.add_argument(
        "--division", type=int, default=4, help="grid cells per beat (default 4 = 16ths)"
    )
    p_tr.add_argument(
        "--no-download", action="store_true", help="use only already-available models"
    )
    p_tr.add_argument("--json", action="store_true", help="also print the timeline as JSON")
    p_tr.add_argument("--quiet", action="store_true")
    p_tr.set_defaults(func=cmd_transcribe)

    p_en = sub.add_parser("enhance", help="repair/restore a file")
    p_en.add_argument("input")
    p_en.add_argument(
        "--chain",
        default=None,
        help="steps: declip,dehum,denoise,dereverb,superres,master,normalize; default: auto",
    )
    p_en.add_argument("--reference", default=None, help="reference audio for the 'master' step")
    p_en.add_argument("--out", default=None, help="output path (default: <input>.restored.wav)")
    p_en.add_argument("--bit-depth", type=int, default=24, choices=[16, 24, 32])
    p_en.add_argument(
        "--no-download", action="store_true", help="use only already-available models"
    )
    p_en.add_argument("--quiet", action="store_true")
    p_en.set_defaults(func=cmd_enhance)

    p_mod = sub.add_parser("models", help="list registered models")
    p_mod.add_argument("action", nargs="?", default="list", choices=["list"])
    p_mod.set_defaults(func=cmd_models)

    p_dl = sub.add_parser("download", help="download model weights")
    p_dl.add_argument("model_id", nargs="?", default=None, help="model id to download")
    p_dl.add_argument("--all", action="store_true", help="download all available models' weights")
    p_dl.add_argument("--task", default=None, help="download all available models for a task")
    p_dl.add_argument("--quiet", action="store_true")
    p_dl.set_defaults(func=cmd_download)

    p_ui = sub.add_parser("ui", help="open the local interface in a browser")
    p_ui.add_argument("--port", type=int, default=8377)
    p_ui.add_argument("--no-browser", action="store_true")
    p_ui.add_argument(
        "--ws-port",
        type=int,
        default=None,
        help="also serve the JSON-RPC WS control channel on this port "
        "(needs the optional 'websockets' package)",
    )
    p_ui.set_defaults(func=cmd_ui)

    p_session = sub.add_parser("session", help="portable session files (roadmap §10.2)")
    session_sub = p_session.add_subparsers(dest="session_command", required=True)

    p_ss = session_sub.add_parser("save", help="pin a source file's fingerprint into a session")
    p_ss.add_argument("input", help="source audio file to fingerprint and pin")
    p_ss.add_argument("--name", default=None, help="session name (default: input file stem)")
    p_ss.add_argument("--preset", default=None, help="record a planner preset in graph_config")
    p_ss.add_argument("--job", default=None, help="record a job kind in graph_config")
    p_ss.add_argument(
        "--home",
        default=None,
        help="session home dir (default: %%LOCALAPPDATA%%/Neiro or ~/.neiro)",
    )
    p_ss.set_defaults(func=cmd_session_save)

    p_sl = session_sub.add_parser("load", help="print a saved session as JSON")
    p_sl.add_argument("name", help="session name or a direct path to a .neiro.json file")
    p_sl.add_argument(
        "--home",
        default=None,
        help="session home dir (default: %%LOCALAPPDATA%%/Neiro or ~/.neiro)",
    )
    p_sl.set_defaults(func=cmd_session_load)

    p_slist = session_sub.add_parser("list", help="list saved session names")
    p_slist.add_argument(
        "--home",
        default=None,
        help="session home dir (default: %%LOCALAPPDATA%%/Neiro or ~/.neiro)",
    )
    p_slist.set_defaults(func=cmd_session_list)

    p_watch = sub.add_parser("watch", help="watch a folder and batch-process new audio")
    p_watch.add_argument("inbox", help="input folder to watch")
    p_watch.add_argument("--out", required=True, help="output directory")
    p_watch.add_argument("--job", default="separate", choices=["separate", "transcribe", "enhance"])
    p_watch.add_argument("--preset", default="vocals")
    p_watch.add_argument("--poll", type=float, default=2.0)
    p_watch.add_argument("--once", action="store_true")
    p_watch.add_argument("--quiet", action="store_true")
    p_watch.set_defaults(func=cmd_watch)

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
