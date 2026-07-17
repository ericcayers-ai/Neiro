#!/usr/bin/env python
"""Full UI-registry matrix on a YouTube (or local) fixture.

Covers every Separate preset × quality tier, every Restore chain (+ explicit
neural enhance steps), and every Transcribe model × applicable mode / quality
preset. Forces ``auto_download=True``. Cells that need an install-only package
are marked ``needs-install`` (never silent skip when a download would work).

    python scripts/matrix_youtube_song.py
    python scripts/matrix_youtube_song.py --url https://www.youtube.com/watch?v=aef1j0PM3Sg
    python scripts/matrix_youtube_song.py --audio path/to/fixture.wav --quick
    python scripts/matrix_youtube_song.py --base-url http://127.0.0.1:8377

Writes ``scratch_matrix/report.json`` and ``scratch_matrix/report.md``.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# UI registries (keep in sync with frontend/src/constants/options.ts)
SEPARATE_PRESETS = [
    "vocals",
    "vocals-ensemble",
    "vocals-neural-ensemble",
    "vocals-best",
    "karaoke",
    "4stem",
    "6stem",
    "detect-all",
    "harmonic",
    "cinematic",
    "drums",
    "duet-vocals",
    "drums-deep-dive",
]
QUALITY_TIERS = ["draft", "standard", "reference"]
RESTORE_CHAINS = [
    "auto",
    "clean",
    "old-noisy",
    "fix-clipping",
    "more-air",
    "match-reference",
]
ENHANCE_NEURAL_STEPS = ["denoise", "dereverb", "restore", "master"]
TRANSCRIBE_MODELS = [
    "",
    "tr-ensemble-default",
    "yourmt3",
    "piano-transcription",
    "transkun-piano",
    "basic-pitch",
    "multi-instrument",
    "svt-melody",
    "timbre-amt",
    "dsp-yin",
    "drums-dsp",
    "drums-neural",
    "noise-to-notes",
    "whisper-lyrics",
]
TRANSCRIBE_MODES = ["direct", "split", "ensemble"]
TRANSCRIBE_QUALITY = [
    ("draft", "direct", "dsp-yin"),
    ("standard", "auto", ""),
    ("reference", "direct", "multi-instrument"),
    ("ensemble", "ensemble", "tr-ensemble-default"),
]

DEFAULT_URL = "https://www.youtube.com/watch?v=aef1j0PM3Sg"


@dataclass
class CellResult:
    cell: str
    kind: str
    status: str  # pass | error | needs-install | cancelled
    model: str | None = None
    notes: list[str] = field(default_factory=list)
    error: str | None = None
    duration_s: float = 0.0
    download_notes: list[str] = field(default_factory=list)
    extras: dict[str, Any] = field(default_factory=dict)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _out_dir(root: Path) -> Path:
    d = root / "scratch_matrix"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _classify_error(exc: BaseException, notes: list[str] | None = None) -> tuple[str, str]:
    """Return (status, message). Prefer needs-install over generic error."""
    msg = str(exc).strip() or type(exc).__name__
    blob = " ".join([msg] + list(notes or [])).lower()
    install_markers = (
        "needs install",
        "not installed",
        "dependency not installed",
        "requires:",
        "no module named",
        "pip install",
        "extra",
        "neiro[",
    )
    if any(m in blob for m in install_markers):
        return "needs-install", msg
    return "error", msg


def _download_notes(notes: list[str]) -> list[str]:
    return [n for n in notes if "download" in n.lower()]


def ingest_fixture(url: str, audio: Path | None, work: Path) -> Path:
    if audio is not None:
        dest = work / "fixture.wav"
        if audio.resolve() != dest.resolve():
            shutil.copy2(audio, dest)
        return dest

    from neiro.io.url_ingest import fetch_url_audio

    cached = fetch_url_audio(url)
    dest = work / "fixture.wav"
    shutil.copy2(cached, dest)
    return dest


# ── Direct engine path ──────────────────────────────────────────────────────


def _run_separate_cell(
    wav: Path, preset: str, quality: str, registry, vram, progress=None
) -> CellResult:
    from neiro.engine.cache import ArtifactCache
    from neiro.engine.graph import ExecutionContext
    from neiro.engine.planner import plan_separation

    cell = f"separate/{preset}/{quality}"
    t0 = time.perf_counter()
    try:
        plan = plan_separation(
            wav,
            preset,
            registry,
            vram,
            quality=quality,
            auto_download=True,
            progress=progress,
        )
        notes = list(plan.notes)
        # Honest install gap: preferred models unavailable and we fell to nothing useful
        for n in notes:
            if "needs install" in n.lower() or "dependency not installed" in n.lower():
                return CellResult(
                    cell=cell,
                    kind="separate",
                    status="needs-install",
                    model=plan.model_id,
                    notes=notes,
                    download_notes=_download_notes(notes),
                    duration_s=time.perf_counter() - t0,
                    error=n,
                )
        ctx = ExecutionContext(cache=ArtifactCache(max_entries=8), progress=progress)
        targets = [plan.residual_node or plan.separate_node]
        outputs = plan.graph.execute(ctx, targets=targets)
        stem_count = len(outputs.get(plan.separate_node) or {})
        return CellResult(
            cell=cell,
            kind="separate",
            status="pass",
            model=plan.model_id,
            notes=notes,
            download_notes=_download_notes(notes),
            duration_s=time.perf_counter() - t0,
            extras={"stems": stem_count},
        )
    except Exception as exc:
        status, msg = _classify_error(exc)
        return CellResult(
            cell=cell,
            kind="separate",
            status=status,
            error=msg,
            duration_s=time.perf_counter() - t0,
            extras={"traceback": traceback.format_exc()[-800:]},
        )


def _run_enhance_cell(
    wav: Path, chain_label: str, chain: list[str] | None, registry, vram, progress=None
) -> CellResult:
    from neiro.engine.cache import ArtifactCache
    from neiro.engine.graph import ExecutionContext
    from neiro.engine.planner import plan_enhancement

    cell = f"enhance/{chain_label}"
    t0 = time.perf_counter()
    try:
        plan = plan_enhancement(
            wav,
            registry,
            vram,
            chain=chain,
            auto_download=True,
            progress=progress,
        )
        notes = list(plan.notes)
        # Explicit neural step requested but nothing applied -> install gap
        if chain and not plan.chain:
            for n in notes:
                if "no available model" in n.lower() or "skipped" in n.lower():
                    return CellResult(
                        cell=cell,
                        kind="enhance",
                        status="needs-install",
                        notes=notes,
                        download_notes=_download_notes(notes),
                        duration_s=time.perf_counter() - t0,
                        error=n,
                        extras={"requested": chain, "applied": plan.chain},
                    )
        if plan.chain:
            ctx = ExecutionContext(cache=ArtifactCache(max_entries=8), progress=progress)
            plan.graph.execute(ctx, targets=[plan.output_node])
        return CellResult(
            cell=cell,
            kind="enhance",
            status="pass",
            notes=notes,
            download_notes=_download_notes(notes),
            duration_s=time.perf_counter() - t0,
            extras={"chain": plan.chain},
        )
    except Exception as exc:
        status, msg = _classify_error(exc)
        return CellResult(
            cell=cell,
            kind="enhance",
            status=status,
            error=msg,
            duration_s=time.perf_counter() - t0,
            extras={"traceback": traceback.format_exc()[-800:]},
        )


def _run_transcribe_cell(
    wav: Path,
    mode: str,
    model: str,
    registry,
    vram,
    *,
    label: str | None = None,
    progress=None,
) -> CellResult:
    from neiro.engine.cache import ArtifactCache
    from neiro.engine.graph import ExecutionContext
    from neiro.engine.planner import plan_transcription

    cell = label or f"transcribe/{mode}/{model or 'default'}"
    t0 = time.perf_counter()
    try:
        # Lyrics-only is not a MIDI transcription path
        if model == "whisper-lyrics":
            entry = None
            try:
                entry = registry.get("whisper-lyrics")
            except KeyError:
                pass
            if entry is None or not entry.available():
                return CellResult(
                    cell=cell,
                    kind="transcribe",
                    status="needs-install",
                    model=model,
                    error="whisper-lyrics needs openai-whisper (lyrics ASR, not MIDI)",
                    duration_s=time.perf_counter() - t0,
                )
        plan = plan_transcription(
            wav,
            registry,
            vram,
            mode=mode,
            model=model or None,
            auto_download=True,
            progress=progress,
        )
        notes = list(plan.notes)
        for n in notes:
            low = n.lower()
            if "needs install" in low or "needs-install" in low or ("no members available" in low and mode == "ensemble"):
                return CellResult(
                    cell=cell,
                    kind="transcribe",
                    status="needs-install",
                    model=plan.model_id,
                    notes=notes,
                    download_notes=_download_notes(notes),
                    duration_s=time.perf_counter() - t0,
                    error=n,
                )
        ctx = ExecutionContext(cache=ArtifactCache(max_entries=8), progress=progress)
        outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
        timeline = outputs[plan.compile_node]["timeline"]
        return CellResult(
            cell=cell,
            kind="transcribe",
            status="pass",
            model=plan.model_id,
            notes=notes,
            download_notes=_download_notes(notes),
            duration_s=time.perf_counter() - t0,
            extras={"events": timeline.total_events(), "used_split": plan.used_split},
        )
    except Exception as exc:
        status, msg = _classify_error(exc)
        return CellResult(
            cell=cell,
            kind="transcribe",
            status=status,
            model=model or None,
            error=msg,
            duration_s=time.perf_counter() - t0,
            extras={"traceback": traceback.format_exc()[-800:]},
        )


def run_matrix_direct(
    wav: Path,
    *,
    quick: bool = False,
    presets: list[str] | None = None,
    skip_transcribe: bool = False,
) -> list[CellResult]:
    from neiro.engine.registry import default_registry
    from neiro.engine.vram import VRAMManager

    registry = default_registry()
    vram = VRAMManager()
    results: list[CellResult] = []

    sep_presets = presets or SEPARATE_PRESETS
    tiers = ["draft"] if quick else QUALITY_TIERS
    if quick:
        sep_presets = [p for p in sep_presets if p in ("vocals", "harmonic", "4stem")]

    print(f"\n=== Separate ({len(sep_presets)} × {len(tiers)}) ===")
    for preset in sep_presets:
        for quality in tiers:
            print(f"  {preset}/{quality} ...", flush=True)
            r = _run_separate_cell(wav, preset, quality, registry, vram)
            print(f"    -> {r.status} ({r.duration_s:.1f}s) model={r.model}")
            results.append(r)

    from neiro.analysis.restore_recommend import resolve_layman_chain

    restore_list = ["auto", "clean"] if quick else RESTORE_CHAINS
    print(f"\n=== Restore chains ({len(restore_list)}) ===")
    for name in restore_list:
        chain = resolve_layman_chain(name)
        print(f"  {name} ...", flush=True)
        r = _run_enhance_cell(wav, name, chain, registry, vram)
        print(f"    -> {r.status} ({r.duration_s:.1f}s) chain={r.extras.get('chain')}")
        results.append(r)

    neural = ["denoise"] if quick else ENHANCE_NEURAL_STEPS
    print(f"\n=== Enhance neural steps ({len(neural)}) ===")
    for step in neural:
        print(f"  {step} ...", flush=True)
        r = _run_enhance_cell(wav, f"step:{step}", [step], registry, vram)
        print(f"    -> {r.status} ({r.duration_s:.1f}s)")
        results.append(r)

    if skip_transcribe:
        return results

    if quick:
        tr_cells = [("quality/draft", "direct", "dsp-yin"), ("quality/standard", "auto", "")]
    else:
        tr_cells = []
        for qname, mode, model in TRANSCRIBE_QUALITY:
            tr_cells.append((f"quality/{qname}", mode, model))
        for model in TRANSCRIBE_MODELS:
            if model == "whisper-lyrics":
                tr_cells.append((f"model/{model or 'default'}", "direct", model))
                continue
            modes = ["direct"]
            if model in ("", "tr-ensemble-default") or model.startswith("tr-"):
                modes = ["direct", "ensemble"] if model else ["direct", "split", "auto"]
            elif model in ("multi-instrument", "yourmt3", "basic-pitch", "dsp-yin"):
                modes = ["direct", "split"]
            for mode in modes:
                if mode == "ensemble" and model not in ("", "tr-ensemble-default"):
                    continue
                tr_cells.append((f"model/{model or 'default'}/{mode}", mode, model))

    print(f"\n=== Transcribe ({len(tr_cells)}) ===")
    for label, mode, model in tr_cells:
        print(f"  {label} ...", flush=True)
        r = _run_transcribe_cell(wav, mode, model, registry, vram, label=f"transcribe/{label}")
        print(f"    -> {r.status} ({r.duration_s:.1f}s) model={r.model}")
        results.append(r)

    return results


# ── HTTP path (against a running `neiro ui` server) ─────────────────────────


def _http_json(base: str, method: str, path: str, body: dict | None = None, timeout: float = 600):
    import urllib.error
    import urllib.request

    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"error": raw or str(exc)}
        raise RuntimeError(payload.get("error") or str(exc)) from exc


def _http_poll(base: str, job_id: str, timeout_s: float = 1800) -> dict:
    t0 = time.time()
    while True:
        job = _http_json(base, "GET", f"/api/job/{job_id}")
        if job.get("status") in ("done", "error", "cancelled"):
            return job
        if time.time() - t0 > timeout_s:
            raise TimeoutError(f"job {job_id} timed out after {timeout_s}s")
        time.sleep(1.0)


def run_matrix_http(base: str, url: str, *, quick: bool = False) -> list[CellResult]:
    print(f"Ingesting via {base}/api/ingest-url ...")
    uploaded = _http_json(base, "POST", "/api/ingest-url", {"url": url}, timeout=300)
    file_id = uploaded["file_id"]
    results: list[CellResult] = []

    sep_presets = ["vocals", "harmonic"] if quick else SEPARATE_PRESETS
    tiers = ["draft"] if quick else QUALITY_TIERS
    for preset in sep_presets:
        for quality in tiers:
            cell = f"separate/{preset}/{quality}"
            print(f"  {cell} ...", flush=True)
            t0 = time.perf_counter()
            try:
                jid = _http_json(
                    base,
                    "POST",
                    "/api/separate",
                    {"file_id": file_id, "preset": preset, "quality": quality},
                )["job_id"]
                job = _http_poll(base, jid)
                notes = list((job.get("result") or {}).get("notes") or [])
                if job["status"] == "done":
                    results.append(
                        CellResult(
                            cell=cell,
                            kind="separate",
                            status="pass",
                            model=(job.get("result") or {}).get("model"),
                            notes=notes,
                            download_notes=_download_notes(notes),
                            duration_s=time.perf_counter() - t0,
                        )
                    )
                else:
                    status, msg = _classify_error(RuntimeError(job.get("error") or "failed"), notes)
                    results.append(
                        CellResult(
                            cell=cell,
                            kind="separate",
                            status=status,
                            error=msg,
                            notes=notes,
                            duration_s=time.perf_counter() - t0,
                        )
                    )
            except Exception as exc:
                status, msg = _classify_error(exc)
                results.append(
                    CellResult(
                        cell=cell,
                        kind="separate",
                        status=status,
                        error=msg,
                        duration_s=time.perf_counter() - t0,
                    )
                )
            print(f"    -> {results[-1].status}")

    restore_list = ["auto", "clean"] if quick else RESTORE_CHAINS
    for name in restore_list:
        cell = f"enhance/{name}"
        print(f"  {cell} ...", flush=True)
        t0 = time.perf_counter()
        try:
            jid = _http_json(
                base, "POST", "/api/enhance", {"file_id": file_id, "chain": name}
            )["job_id"]
            job = _http_poll(base, jid)
            notes = list((job.get("result") or {}).get("notes") or [])
            if job["status"] == "done":
                results.append(
                    CellResult(
                        cell=cell,
                        kind="enhance",
                        status="pass",
                        notes=notes,
                        download_notes=_download_notes(notes),
                        duration_s=time.perf_counter() - t0,
                        extras={"chain": (job.get("result") or {}).get("chain")},
                    )
                )
            else:
                status, msg = _classify_error(RuntimeError(job.get("error") or "failed"), notes)
                results.append(
                    CellResult(
                        cell=cell,
                        kind="enhance",
                        status=status,
                        error=msg,
                        notes=notes,
                        duration_s=time.perf_counter() - t0,
                    )
                )
        except Exception as exc:
            status, msg = _classify_error(exc)
            results.append(
                CellResult(
                    cell=cell, kind="enhance", status=status, error=msg, duration_s=time.perf_counter() - t0
                )
            )
        print(f"    -> {results[-1].status}")

    return results


def write_report(out: Path, results: list[CellResult], meta: dict) -> None:
    payload = {
        "meta": meta,
        "summary": {
            "total": len(results),
            "pass": sum(1 for r in results if r.status == "pass"),
            "needs-install": sum(1 for r in results if r.status == "needs-install"),
            "error": sum(1 for r in results if r.status == "error"),
            "cancelled": sum(1 for r in results if r.status == "cancelled"),
        },
        "cells": [asdict(r) for r in results],
    }
    (out / "report.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [
        "# Neiro matrix report",
        "",
        f"- fixture: `{meta.get('fixture')}`",
        f"- mode: `{meta.get('mode')}`",
        f"- total: **{payload['summary']['total']}**",
        f"- pass: **{payload['summary']['pass']}**",
        f"- needs-install: **{payload['summary']['needs-install']}**",
        f"- error: **{payload['summary']['error']}**",
        "",
        "| Cell | Status | Model | Duration | Notes / error |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for r in results:
        note = r.error or ("; ".join(r.download_notes[:2] + r.notes[:1]) if (r.download_notes or r.notes) else "")
        note = note.replace("|", "/").replace("\n", " ")[:120]
        lines.append(
            f"| `{r.cell}` | {r.status} | {r.model or '—'} | {r.duration_s:.1f}s | {note} |"
        )
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nWrote {out / 'report.json'} and {out / 'report.md'}")
    print(json.dumps(payload["summary"], indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default=DEFAULT_URL, help="YouTube (or other) URL to ingest")
    ap.add_argument("--audio", type=Path, default=None, help="Skip URL ingest; use this WAV")
    ap.add_argument(
        "--base-url",
        default=None,
        help="If set, drive a running Neiro UI server over HTTP instead of in-process",
    )
    ap.add_argument("--quick", action="store_true", help="Smoke subset for CI / fast iteration")
    ap.add_argument("--skip-transcribe", action="store_true")
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output directory (default: <repo>/scratch_matrix)",
    )
    args = ap.parse_args()

    root = _repo_root()
    out = args.out or _out_dir(root)
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    if args.base_url:
        results = run_matrix_http(args.base_url, args.url, quick=args.quick)
        meta = {
            "fixture": args.url,
            "mode": "http",
            "base_url": args.base_url,
            "quick": args.quick,
            "elapsed_s": time.perf_counter() - t0,
        }
    else:
        print(f"Ingesting fixture -> {work / 'fixture.wav'} ...")
        wav = ingest_fixture(args.url, args.audio, work)
        print(f"  ok: {wav} ({wav.stat().st_size / 1e6:.1f} MB)")
        results = run_matrix_direct(
            wav, quick=args.quick, skip_transcribe=args.skip_transcribe
        )
        meta = {
            "fixture": str(args.audio or args.url),
            "mode": "direct",
            "quick": args.quick,
            "elapsed_s": time.perf_counter() - t0,
        }

    write_report(out, results, meta)
    # Non-zero only on hard errors (needs-install is expected on sparse machines)
    return 1 if any(r.status == "error" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
