"""Watch-folder / batch daemon (roadmap §2.1, phase 8).

Polls an input directory for new audio files, runs a configured planner job, and
writes artifacts to an output directory. Safe to run headless alongside the UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import ExecutionContext, Progress
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager

AUDIO_EXTS = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aac", ".aiff", ".aif", ".wma", ".opus"}


def _fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    h.update(str(path.resolve()).encode())
    h.update(str(path.stat().st_mtime_ns).encode())
    h.update(str(path.stat().st_size).encode())
    return h.hexdigest()[:24]


def _progress(quiet: bool):
    def _p(prog: Progress) -> None:
        if quiet:
            return
        print(f"  [{prog.node_id}] {prog.stage}: {prog.message}", file=sys.stderr)

    return _p


def process_file(
    path: Path,
    *,
    job: str,
    preset: str,
    out_dir: Path,
    quiet: bool,
) -> Path:
    from neiro.engine.planner import plan_enhancement, plan_separation, plan_transcription
    from neiro.io import write_audio
    from neiro.symbolic import write_midi

    registry = default_registry()
    vram = VRAMManager()
    cache = ArtifactCache(max_entries=32)
    ctx = ExecutionContext(cache=cache, progress=_progress(quiet))
    dest = out_dir / path.stem
    dest.mkdir(parents=True, exist_ok=True)

    if job == "separate":
        plan = plan_separation(path, preset, registry, vram)
        outputs = plan.graph.execute(ctx, targets=[plan.residual_node or plan.separate_node])
        for name, art in outputs[plan.separate_node].items():
            write_audio(art, dest / f"{name}.wav", fmt="wav", bit_depth=24)
        if plan.residual_node:
            resid = outputs[plan.residual_node]["residual"]
            write_audio(resid, dest / "residual.wav", fmt="wav", bit_depth=24)
    elif job == "transcribe":
        plan = plan_transcription(path, registry, vram, mode="auto")
        outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
        timeline = outputs[plan.compile_node]
        write_midi(timeline, dest / f"{path.stem}.mid")
    elif job == "enhance":
        chain = (
            None
            if preset in ("auto", "vocals")
            else [s.strip() for s in preset.split(",") if s.strip()]
        )
        plan = plan_enhancement(path, registry, vram, chain=chain)
        outputs = plan.graph.execute(ctx, targets=[plan.output_node])
        art = outputs[plan.output_node]
        write_audio(art, dest / f"{path.stem}.restored.wav", fmt="wav", bit_depth=24)
    else:
        raise ValueError(f"unknown job {job!r}")

    meta = {
        "source": str(path),
        "job": job,
        "preset": preset,
        "fingerprint": _fingerprint(path),
    }
    (dest / "job.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return dest


def watch_loop(
    inbox: Path,
    out_dir: Path,
    *,
    job: str = "separate",
    preset: str = "vocals",
    poll_seconds: float = 2.0,
    quiet: bool = False,
    once: bool = False,
) -> int:
    inbox.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    state_path = out_dir / ".neiro-watch-state.json"
    seen: dict[str, str] = {}
    if state_path.is_file():
        try:
            seen = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            seen = {}

    def scan() -> int:
        processed = 0
        for path in sorted(inbox.iterdir()):
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
                continue
            fp = _fingerprint(path)
            key = str(path.resolve())
            if seen.get(key) == fp:
                continue
            if not quiet:
                print(f"Processing {path.name} …", file=sys.stderr)
            try:
                dest = process_file(path, job=job, preset=preset, out_dir=out_dir, quiet=quiet)
                seen[key] = fp
                state_path.write_text(json.dumps(seen, indent=2), encoding="utf-8")
                if not quiet:
                    print(f"  wrote {dest}", file=sys.stderr)
                processed += 1
            except Exception as exc:
                print(f"  failed {path.name}: {exc}", file=sys.stderr)
        return processed

    if once:
        scan()
        return 0

    if not quiet:
        print(f"Watching {inbox} → {out_dir} ({job}/{preset})", file=sys.stderr)
    while True:
        scan()
        time.sleep(poll_seconds)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inbox", type=Path, help="Folder to watch for new audio")
    ap.add_argument("--out", type=Path, required=True, help="Output directory")
    ap.add_argument("--job", choices=("separate", "transcribe", "enhance"), default="separate")
    ap.add_argument("--preset", default="vocals")
    ap.add_argument("--poll", type=float, default=2.0)
    ap.add_argument("--once", action="store_true", help="Process current files and exit")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    return watch_loop(
        args.inbox,
        args.out,
        job=args.job,
        preset=args.preset,
        poll_seconds=args.poll,
        quiet=args.quiet,
        once=args.once,
    )


if __name__ == "__main__":
    raise SystemExit(main())
