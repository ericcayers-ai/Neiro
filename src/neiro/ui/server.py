"""Local HTTP server for the Neiro worksuite.

Standard library only, bound to 127.0.0.1 — nothing is exposed to the network
and no audio leaves the machine (roadmap principle 2). The browser/Tauri page is
a thin client over the same planner/graph engine as the CLI.

Endpoints:
    GET  /                      React SPA (or legacy redirect)
    GET  /api/health            liveness {status, version, engine}
    GET  /api/version           {name, version, api_version}
    POST /api/upload            raw audio bytes (X-Filename header) -> analysis
    POST /api/ingest-url        {url}               -> analysis (yt-dlp)
    POST /api/separate          {file_id, preset}   -> job id
    GET  /api/models            ?task=transcribe -> registry status (ready/needs-install)
    POST /api/transcribe        {file_id, mode, model?, members?, ensemble?} -> job id
    POST /api/enhance           {file_id, chain?}   -> job id
    POST /api/pitch_correct     {file_id, key?, strength?} -> job id (cancellable)
    GET  /api/job/<id>          job status, progress lines, result
    POST /api/job/<id>/cancel   cooperative cancel
    GET  /api/file/<id>/parent  parent file_id from edit chain (Reset to original)
    GET  /api/prefs             cache budget, warm-pool TTL, residents
    POST /api/prefs             update cache_budget_gb / warm_pool_ttl_s
    POST /api/prefs/flush       drop warm-pool residents (+ optional cache clear)
    GET  /api/waveform          ?file_id&width[&start&end] -> peak envelope
    GET  /api/spectrogram       ?file_id            -> quantised log-freq grid
    POST /api/edit              {file_id, op, ...}  -> new (edited) file_id
                            bounce: {op:bounce, tracks:[{file_id,gain,pan,offset}]}
                            split:  {file_id, op:split, at} -> {left, right}
                            pitch_correct: {file_id, op:pitch_correct, key?, strength?}
    GET  /api/plugins           list local user Python plugins + grants
    POST /api/plugins           update plugin grants
    GET  /api/compute           warm-pool / VRAM residency status
    POST /api/compute           {action: flush|status}
    GET  /api/session/list      portable sessions on disk
    POST /api/session/save      save current session metadata
    POST /api/session/open      open a saved session document
    GET  /api/plan              ?kind&file_id&preset… → planned DAG strip
    GET  /api/bulk/waveform     Arrow IPC peaks (JSON fallback via Accept)
    GET/POST /api/notes/<job>   piano-roll note CRUD for a transcription job
    GET  /api/export            ?file_id&format     -> wav16|wav24|flac download
    GET  /api/analyze           ?file_id            -> re-estimate BPM/key report
    GET  /api/daw/status        shared-window DAW injector status
    GET  /api/daw/midi          ?after_seq=N        Learn MIDI from DAW injectors
    POST /api/daw/register      register a VST/CLAP injector instance
    POST /api/daw/unregister    drop an injector
    POST /api/daw/heartbeat     keep-alive + peak / recording / preferred module
    POST /api/daw/show-ui       focus the single Neiro window (any module)
    POST /api/daw/midi          push a MIDI note from the DAW into Learn
    POST /api/daw/capture       Edison-style track capture (WAV body) -> file + focus
    GET  /files/<...>           artifacts (stems, MIDI, edits) from the workspace
"""

from __future__ import annotations

import contextlib
import json
import mimetypes
import re
import tempfile
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from neiro import __version__
from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import CancelledError, ExecutionContext, Progress
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager

__all__ = ["serve"]

_API_VERSION = 1

_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".json": "application/json",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mid": "audio/midi",
    ".ico": "image/x-icon",
}

_STATIC_DIR = Path(__file__).resolve().parent / "static"
_LEGACY_INDEX = Path(__file__).resolve().parent / "index.html"

_EXPORT_FORMATS = {
    "wav16": ("wav", 16, "audio/wav"),
    "wav24": ("wav", 24, "audio/wav"),
    "flac": ("flac", 16, "audio/flac"),
}


class _State:
    def __init__(self) -> None:
        self.workspace = Path(tempfile.mkdtemp(prefix="neiro-ui-"))
        self.registry = default_registry()
        self.vram = VRAMManager()
        self.cache = ArtifactCache(max_entries=64)
        self.files: dict[str, Path] = {}
        self.parents: dict[str, str] = {}  # edited file_id -> file_id it derived from
        self.jobs: dict[str, dict] = {}
        self.job_contexts: dict[str, ExecutionContext] = {}
        self.transcription_sessions: dict[str, Any] = {}
        self.lock = threading.Lock()
        self.port = 8377
        # Optional: set by serve() when the WS control channel is enabled, so
        # progress lines get pushed there too, not just appended for polling.
        self.ws_hub = None
        # Compute prefs — mirrored to ArtifactCache / VRAMManager on update.
        self.prefs: dict = {
            "cache_budget_gb": 20.0,
            "warm_pool_ttl_s": 300.0,
        }
        self._apply_prefs()

    def _apply_prefs(self) -> None:
        budget_gb = float(self.prefs.get("cache_budget_gb", 20.0))
        ttl = float(self.prefs.get("warm_pool_ttl_s", 300.0))
        self.cache.disk_budget_bytes = int(max(0.1, budget_gb) * 1_000_000_000)
        self.vram.warm_pool_ttl_s = max(0.0, ttl)
        self.vram.evict_expired()

    def prefs_snapshot(self) -> dict:
        self.vram.evict_expired()
        return {
            "cache_budget_gb": float(self.prefs["cache_budget_gb"]),
            "warm_pool_ttl_s": float(self.prefs["warm_pool_ttl_s"]),
            "cache_entries": len(self.cache),
            "cache_hits": self.cache.hits,
            "cache_misses": self.cache.misses,
            "cache_disk_usage_bytes": self.cache.disk_usage_bytes(),
            "resident_models": self.vram.resident_models(),
        }

    def update_prefs(self, body: dict) -> dict:
        if "cache_budget_gb" in body:
            self.prefs["cache_budget_gb"] = float(body["cache_budget_gb"])
        if "warm_pool_ttl_s" in body:
            self.prefs["warm_pool_ttl_s"] = float(body["warm_pool_ttl_s"])
        self._apply_prefs()
        return self.prefs_snapshot()

    def flush_compute(self, *, clear_cache: bool = False) -> dict:
        flushed = self.vram.flush()
        if clear_cache:
            self.cache.clear()
        return {
            "flushed_models": flushed,
            "cache_cleared": clear_cache,
            **self.prefs_snapshot(),
        }

    def load(self, file_id: str):
        from neiro.io import load_audio

        return load_audio(self.files[file_id])

    def register(self, name: str, audio, subdir: str = "edits") -> str:
        from neiro.io import write_audio

        file_id = uuid.uuid4().hex[:12]
        dest = self.workspace / subdir / file_id / name
        write_audio(audio, dest, fmt="wav", bit_depth=24)
        self.files[file_id] = dest
        return file_id

    def register_path(self, path: Path) -> str:
        file_id = uuid.uuid4().hex[:12]
        self.files[file_id] = path
        return file_id


def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name).name)
    return base or "upload.wav"


def _job_progress(state: _State, job_id: str):
    started = time.monotonic()

    def _cb(prog: Progress) -> None:
        line = f"{prog.node_id}: {prog.stage}" + (f" — {prog.message}" if prog.message else "")
        eta_s = None
        if prog.fraction and prog.fraction > 0.02:
            elapsed = time.monotonic() - started
            eta_s = round(elapsed * (1.0 - prog.fraction) / prog.fraction, 1)
        event = {
            "stage": prog.stage,
            "fraction": prog.fraction,
            "eta_s": eta_s,
            "line": line,
            "node_id": prog.node_id,
            "message": prog.message or "",
        }
        with state.lock:
            job = state.jobs.get(job_id)
            if job is not None:
                job["progress"].append(line)
                job.setdefault("progress_events", []).append(event)
                job["stage"] = prog.stage
                job["fraction"] = prog.fraction
                job["eta_s"] = eta_s
        if state.ws_hub is not None:
            state.ws_hub.publish(job_id, line)

    return _cb


def _normalize_corrections(raw) -> dict | None:
    """Accept a corrections overlay dict from the job body, or None."""
    if not raw or not isinstance(raw, dict):
        return None
    overrides = raw.get("overrides")
    if not isinstance(overrides, dict) or not overrides:
        return None
    return {
        "overrides": overrides,
        "reasons": dict(raw.get("reasons") or {}),
    }


def _run_separation(
    state: _State,
    job_id: str,
    file_id: str,
    preset: str,
    quality: str | None = None,
    bleed_suppress: bool = True,
    corrections: dict | None = None,
) -> None:
    import numpy as np

    from neiro.engine.planner import plan_separation
    from neiro.io import write_audio, write_export_metadata

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_separation(
        state.files[file_id],
        preset,
        state.registry,
        state.vram,
        quality=quality,
        bleed_suppress=bleed_suppress,
        corrections=corrections,
    )
    ctx = ExecutionContext(
        cache=state.cache,
        progress=_job_progress(state, job_id),
        extras={"analysis_corrections": corrections} if corrections else {},
    )
    with state.lock:
        state.job_contexts[job_id] = ctx
    try:
        outputs = plan.graph.execute(ctx, targets=[plan.residual_node or plan.separate_node])
    finally:
        with state.lock:
            state.job_contexts.pop(job_id, None)

    entry = state.registry.get(plan.model_id)
    files = []
    for name, art in outputs[plan.separate_node].items():
        p = write_audio(art, job_dir / f"{name}.wav", fmt="wav", bit_depth=16)
        meta = write_export_metadata(
            p,
            model_id=plan.model_id,
            license_spdx=entry.license_spdx,
            license_note=entry.license_note,
            provenance=art.provenance,
        )
        stem_id = state.register_path(p)
        files.append(
            {
                "name": name,
                "file_id": stem_id,
                "url": f"/files/jobs/{job_id}/{p.name}",
                "meta_url": f"/files/jobs/{job_id}/{meta.name}",
            }
        )
    rel = state.files[file_id].relative_to(state.workspace)
    result = {
        "model": plan.model_id,
        "files": files,
        "notes": plan.notes,
        "source_url": f"/files/{rel.as_posix()}",
    }
    if plan.residual_node:
        resid = outputs[plan.residual_node]["residual"]
        p = write_audio(resid, job_dir / "residual.wav", fmt="wav", bit_depth=16)
        resid_id = state.register_path(p)
        files.append(
            {
                "name": "residual",
                "file_id": resid_id,
                "url": f"/files/jobs/{job_id}/{p.name}",
            }
        )
        result["null_test_db"] = round(float(20 * np.log10(resid.peak() + 1e-12)), 1)
    with state.lock:
        state.jobs[job_id].update(status="done", result=result)


def _run_transcription(
    state: _State,
    job_id: str,
    file_id: str,
    mode: str,
    model: str | None,
    members: list | None = None,
    corrections: dict | None = None,
) -> None:
    from neiro.engine.planner import plan_transcription
    from neiro.io import write_export_metadata
    from neiro.symbolic import export_score, write_midi

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_transcription(
        state.files[file_id],
        state.registry,
        state.vram,
        mode=mode,
        model=model,
        members=members,
        corrections=corrections,
    )
    ctx = ExecutionContext(
        cache=state.cache,
        progress=_job_progress(state, job_id),
        extras={"analysis_corrections": corrections} if corrections else {},
    )
    with state.lock:
        state.job_contexts[job_id] = ctx
    try:
        outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
    finally:
        with state.lock:
            state.job_contexts.pop(job_id, None)
    timeline = outputs[plan.compile_node]["timeline"]

    midi_path = write_midi(timeline, job_dir / "transcription.mid")
    from neiro.symbolic.session import TranscriptionSession

    tsession = TranscriptionSession(timeline)
    with state.lock:
        state.transcription_sessions[job_id] = tsession

    # MusicXML (+ best-effort SVG/PDF) — expose download URLs from Transcribe.
    key = None
    if corrections and isinstance(corrections.get("overrides"), dict):
        key = corrections["overrides"].get("estimated_key")
    score = export_score(
        timeline,
        job_dir / "transcription",
        key=str(key) if key else None,
        title=state.files[file_id].stem,
        want_pdf=True,
    )
    try:
        entry = state.registry.get(plan.model_id)
    except KeyError:
        entry = None
    meta = write_export_metadata(
        midi_path,
        model_id=plan.model_id,
        license_spdx=entry.license_spdx if entry else "unknown",
        license_note=entry.license_note if entry else "",
        provenance=(plan.model_id,),
        extras={
            "musicxml": score.get("musicxml_path"),
            "score_renderer": score.get("renderer"),
            "score_notes": score.get("notes", []),
            "used_split": plan.used_split,
        },
    )
    tracks = {
        name: [
            {
                "onset": e.onset,
                "offset": e.offset,
                "pitch": e.pitch,
                "velocity": e.velocity,
                "confidence": e.confidence,
                "user_verified": getattr(e, "user_verified", False),
            }
            for e in stream.events
        ]
        for name, stream in timeline.tracks
    }
    result = {
        "model": plan.model_id,
        "used_split": plan.used_split,
        "notes": list(plan.notes) + list(score.get("notes") or []),
        "tempo_bpm": timeline.tempo_bpm,
        "event_count": timeline.total_events(),
        "midi_url": f"/files/jobs/{job_id}/{midi_path.name}",
        "musicxml_url": f"/files/jobs/{job_id}/transcription.musicxml",
        "provenance_url": f"/files/jobs/{job_id}/{meta.name}",
        "tracks": tracks,
        "score_renderer": score.get("renderer"),
        "job_id": job_id,
    }
    if score.get("svg_path"):
        result["score_svg_url"] = f"/files/jobs/{job_id}/{Path(score['svg_path']).name}"
        result["svg_url"] = result["score_svg_url"]
    if score.get("pdf_path"):
        result["score_pdf_url"] = f"/files/jobs/{job_id}/{Path(score['pdf_path']).name}"
    with state.lock:
        state.jobs[job_id].update(status="done", result=result)


def _run_enhancement(
    state: _State,
    job_id: str,
    file_id: str,
    chain: list[str] | None,
    corrections: dict | None = None,
) -> None:
    from neiro.engine.planner import plan_enhancement
    from neiro.io import write_audio

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_enhancement(
        state.files[file_id],
        state.registry,
        state.vram,
        chain=chain,
        corrections=corrections,
    )
    result: dict = {"chain": plan.chain, "notes": plan.notes}
    if plan.chain:
        ctx = ExecutionContext(
            cache=state.cache,
            progress=_job_progress(state, job_id),
            extras={"analysis_corrections": corrections} if corrections else {},
        )
        with state.lock:
            state.job_contexts[job_id] = ctx
        try:
            outputs = plan.graph.execute(ctx, targets=[plan.output_node])
        finally:
            with state.lock:
                state.job_contexts.pop(job_id, None)
        p = write_audio(
            outputs[plan.output_node]["audio"], job_dir / "restored.wav", fmt="wav", bit_depth=16
        )
        restored_id = state.register_path(p)
        result["file_url"] = f"/files/jobs/{job_id}/{p.name}"
        result["file_id"] = restored_id
    with state.lock:
        state.jobs[job_id].update(status="done", result=result)


def _run_pitch_correct(
    state: _State,
    job_id: str,
    file_id: str,
    key: str | None,
    strength: float,
) -> None:
    from neiro.dsp import edit as ed
    from neiro.dsp import waveform_peaks
    from neiro.io import write_audio

    job_dir = state.workspace / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    progress = _job_progress(state, job_id)
    ctx = ExecutionContext(cache=state.cache, progress=progress)
    with state.lock:
        state.job_contexts[job_id] = ctx
    try:
        progress("pitch_correct: loading", fraction=0.05)
        if ctx.cancelled:
            raise CancelledError()
        audio = state.load(file_id)
        progress("pitch_correct: analyzing pitch", fraction=0.15)
        if ctx.cancelled:
            raise CancelledError()

        def _cancel() -> bool:
            return bool(ctx.cancelled)

        result = ed.pitch_correct(
            audio,
            key=key,
            strength=strength,
            cancel_check=_cancel,
        )
        if ctx.cancelled:
            raise CancelledError()
        progress("pitch_correct: writing", fraction=0.9)
        name = _safe_name(Path(state.files[file_id]).stem + ".pitch-correct.wav")
        p = write_audio(result, job_dir / name, fmt="wav", bit_depth=16)
        new_id = state.register_path(p)
        with state.lock:
            state.parents[new_id] = file_id
        payload = {
            "file_id": new_id,
            "parent": file_id,
            "op": "pitch_correct",
            "audio_url": f"/files/jobs/{job_id}/{p.name}",
            "duration": result.duration_seconds,
            "waveform": waveform_peaks(result, width=1200),
            "provenance": getattr(result, "provenance", None),
            "notes": [f"pitch_correct key={key or 'chromatic'} strength={strength:g}"],
        }
        progress("pitch_correct: done", fraction=1.0)
        with state.lock:
            state.jobs[job_id].update(status="done", result=payload)
    finally:
        with state.lock:
            state.job_contexts.pop(job_id, None)


_RUNNERS = {
    "separate": _run_separation,
    "transcribe": _run_transcription,
    "enhance": _run_enhancement,
    "pitch_correct": _run_pitch_correct,
}


def start_job(state: _State, kind: str, file_id: str, body: dict) -> str:
    """Start a job and return its id; shared by the HTTP and WS control planes.

    ``body`` is the same shape either transport hands in (``preset``/``mode``/
    ``model``/``chain``), so a WS ``start_job`` call and a
    ``POST /api/separate`` etc. request run the identical runner with
    identical job bookkeeping — there's exactly one code path for "what does
    starting a job do," regardless of which control channel asked.
    """
    if file_id not in state.files:
        raise KeyError(f"unknown file_id {file_id!r} — upload first")
    if kind not in _RUNNERS:
        raise ValueError(f"unknown job kind {kind!r}")
    job_id = uuid.uuid4().hex[:12]
    with state.lock:
        state.jobs[job_id] = {
            "status": "running",
            "kind": kind,
            "progress": [],
            "progress_events": [],
            "stage": "queued",
            "fraction": 0.0,
            "eta_s": None,
        }
    corrections = _normalize_corrections(body.get("corrections"))
    if kind == "separate":
        quality = body.get("quality")
        bleed_raw = body.get("bleed_suppress", body.get("bleed"))
        if bleed_raw is None or bleed_raw == "auto":
            bleed_suppress = True
        elif isinstance(bleed_raw, str):
            bleed_suppress = bleed_raw.lower() not in {"off", "false", "0", "no"}
        else:
            bleed_suppress = bool(bleed_raw)
        args = (body.get("preset", "vocals"), quality, bleed_suppress, corrections)
    elif kind == "transcribe":
        tr_mode = body.get("mode", "auto")
        tr_model = body.get("model")
        tr_members = body.get("members")
        if body.get("ensemble") and not tr_members:
            tr_mode = "ensemble"
            tr_model = tr_model or "tr-ensemble-default"
        elif tr_members and len(tr_members) >= 2:
            tr_mode = "ensemble"
        args = (tr_mode, tr_model, tr_members, corrections)
    elif kind == "pitch_correct":
        key = body.get("key")
        strength = float(body.get("strength", 1.0))
        args = (str(key) if key else None, strength)
    else:
        args = (_parse_enhance_chain(body.get("chain")), corrections)

    def _work() -> None:
        try:
            _RUNNERS[kind](state, job_id, file_id, *args)
        except CancelledError:
            with state.lock:
                if state.jobs[job_id].get("status") == "running":
                    state.jobs[job_id].update(status="cancelled", error="cancelled")
        except Exception as exc:
            with state.lock:
                if state.jobs[job_id].get("status") != "cancelled":
                    state.jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=_work, daemon=True).start()
    return job_id


def job_status(state: _State, job_id: str) -> dict | None:
    """Same payload shape as ``GET /api/job/<id>``; shared with the WS control plane."""
    with state.lock:
        job = state.jobs.get(job_id)
        if job is None:
            return None
        return {
            "status": job["status"],
            "kind": job["kind"],
            "progress": list(job["progress"]),
            "progress_events": list(job.get("progress_events", [])),
            "stage": job.get("stage"),
            "fraction": job.get("fraction"),
            "eta_s": job.get("eta_s"),
            "result": job.get("result"),
            "error": job.get("error"),
        }


def cancel_job(state: _State, job_id: str) -> dict:
    """Same behavior as ``POST /api/job/<id>/cancel``; shared with the WS control plane."""
    with state.lock:
        ctx = state.job_contexts.get(job_id)
        job = state.jobs.get(job_id)
    if job is None:
        raise KeyError(f"unknown job {job_id!r}")
    if ctx is not None:
        ctx.cancel()
    with state.lock:
        if job.get("status") == "running":
            state.jobs[job_id].update(status="cancelled", error="cancelled by user")
    return {"job_id": job_id, "status": "cancelled"}


def _parse_enhance_chain(raw) -> list[str] | None:
    from neiro.analysis.restore_recommend import resolve_layman_chain

    return resolve_layman_chain(raw)


# Starter packs for Prefs one-click downloads (ids must match manifests).
MODEL_PACKS: dict[str, list[str]] = {
    "separation": ["htdemucs-ft", "scnet", "mel-roformer-kim"],
    "piano": ["piano-transcription", "transkun-piano", "basic-pitch"],
    "restore": ["denoise-roformer", "dereverb-roformer", "apollo", "audiosr"],
    "transcription": ["yourmt3", "multi-instrument", "svt-melody", "timbre-amt"],
}


def _model_size_hint(entry) -> str | None:
    """Best-effort size hint from weight specs or VRAM footprint."""
    for spec in entry.weights:
        for key in ("size_bytes", "bytes", "size"):
            if key in spec and isinstance(spec[key], (int, float)):
                mb = float(spec[key]) / 1e6
                return f"~{mb:.0f} MB" if mb < 1000 else f"~{mb / 1000:.1f} GB"
        note = str(spec.get("note") or "")
        if "GB" in note or "MB" in note:
            return note
    vram = entry.manifest.get("vram") or {}
    gb = vram.get("fp32_gb")
    if isinstance(gb, (int, float)) and gb > 0:
        return f"~{gb:g} GB VRAM"
    if entry.needs_download:
        return "weights on first use"
    return "no weights"


def start_model_download(state: _State, *, model_ids: list[str]) -> str:
    """Background job that fetches model weights; cancellable via cancel_job."""
    job_id = uuid.uuid4().hex[:12]
    with state.lock:
        state.jobs[job_id] = {
            "status": "running",
            "kind": "download",
            "progress": [],
            "progress_events": [],
            "stage": "queued",
            "fraction": 0.0,
            "eta_s": None,
            "model_ids": list(model_ids),
        }

    def _work() -> None:
        from neiro.engine.downloader import DownloadProgress

        ctx = ExecutionContext(cache=state.cache)
        with state.lock:
            state.job_contexts[job_id] = ctx
        done: list[str] = []
        try:
            total = max(1, len(model_ids))
            for i, mid in enumerate(model_ids):
                if ctx.cancelled:
                    raise CancelledError()
                try:
                    entry = state.registry.get(mid)
                except KeyError:
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job:
                            job["progress"].append(f"{mid}: unknown model id, skipped")
                    continue
                if not entry.available():
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job:
                            req = ", ".join(entry.manifest.get("requires", [])) or "deps"
                            job["progress"].append(f"{mid}: needs install ({req})")
                    continue
                if entry.downloaded():
                    done.append(mid)
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job:
                            job["progress"].append(f"{mid}: already downloaded")
                            job["fraction"] = (i + 1) / total
                            job["stage"] = mid
                    continue

                def _prog(p: DownloadProgress, _mid=mid, _i=i) -> None:
                    if ctx.cancelled:
                        raise CancelledError()
                    line = f"{_mid}: downloading"
                    if p.total_bytes:
                        mb = p.downloaded_bytes / 1e6
                        tot = p.total_bytes / 1e6
                        line = f"{_mid}: {mb:.0f}/{tot:.0f} MB"
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job is None:
                            return
                        job["progress"].append(line)
                        job["stage"] = _mid
                        frac_part = p.fraction if p.fraction is not None else 0.0
                        job["fraction"] = min(0.99, (_i + frac_part) / total)
                        job.setdefault("progress_events", []).append(
                            {
                                "stage": _mid,
                                "fraction": job["fraction"],
                                "eta_s": None,
                                "line": line,
                                "node_id": _mid,
                                "message": line,
                            }
                        )

                try:
                    entry.ensure_downloaded(progress=_prog)
                    done.append(mid)
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job:
                            job["progress"].append(f"{mid}: downloaded")
                            job["fraction"] = (i + 1) / total
                            job["stage"] = mid
                except CancelledError:
                    raise
                except Exception as exc:
                    with state.lock:
                        job = state.jobs.get(job_id)
                        if job:
                            job["progress"].append(f"{mid}: failed ({exc})")
            with state.lock:
                job = state.jobs.get(job_id)
                if job and job.get("status") == "running":
                    job.update(
                        status="done",
                        fraction=1.0,
                        stage="done",
                        result={"downloaded": done, "requested": list(model_ids)},
                    )
        except CancelledError:
            with state.lock:
                if state.jobs[job_id].get("status") == "running":
                    state.jobs[job_id].update(status="cancelled", error="cancelled")
        except Exception as exc:
            with state.lock:
                if state.jobs[job_id].get("status") != "cancelled":
                    state.jobs[job_id].update(status="error", error=str(exc))
        finally:
            with state.lock:
                state.job_contexts.pop(job_id, None)

    threading.Thread(target=_work, daemon=True).start()
    return job_id


def tools_status() -> dict:
    """Detect Verovio / MuseScore / soundfont install state for Prefs Tools."""
    import importlib.util

    from neiro.engine.downloader import default_neiro_home
    from neiro.symbolic.score import find_score_renderer

    verovio_ok = importlib.util.find_spec("verovio") is not None
    musescore = find_score_renderer()
    sf_dir = default_neiro_home() / "soundfonts"
    soundfonts = sorted(p.name for p in sf_dir.glob("*.sf2")) if sf_dir.is_dir() else []
    return {
        "verovio": {"installed": verovio_ok, "hint": "pip install verovio"},
        "musescore": {
            "path": musescore,
            "installed": bool(musescore),
            "download_url": "https://musescore.org/en/download",
        },
        "soundfont": {
            "installed": bool(soundfonts),
            "files": soundfonts,
            "urls": [f"/api/soundfonts/{name}" for name in soundfonts],
            "hint": (
                "Download TimGM6mb.sf2 (GM) for MuseScore and to unlock MIDI Studio "
                "browser piano (FluidR3 GM samples; SF2 verified on disk)."
            ),
        },
        "packs": {k: list(v) for k, v in MODEL_PACKS.items()},
    }


# Small GM soundfont for Prefs one-click install (~5–6 MB).
_SOUNDFONT_URL = "https://github.com/cmaj-org/cmaj/raw/main/examples/patches/TimGM6mb.sf2"
_SOUNDFONT_NAME = "TimGM6mb.sf2"


def install_soundfont() -> dict:
    """Download a GM SF2 into ``NEIRO_HOME/soundfonts``."""
    from urllib.request import urlopen

    from neiro.engine.downloader import default_neiro_home

    sf_dir = default_neiro_home() / "soundfonts"
    sf_dir.mkdir(parents=True, exist_ok=True)
    dest = sf_dir / _SOUNDFONT_NAME
    if dest.is_file() and dest.stat().st_size > 100_000:
        return {"ok": True, "path": str(dest), "status": tools_status()}
    try:
        with urlopen(_SOUNDFONT_URL, timeout=180) as resp:  # noqa: S310 — pinned URL
            data = resp.read()
        if len(data) < 1000:
            return {"ok": False, "error": "download too small / failed", "status": tools_status()}
        dest.write_bytes(data)
        return {"ok": True, "path": str(dest), "status": tools_status()}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "status": tools_status()}


def install_verovio() -> dict:
    """Best-effort ``pip install verovio`` for Prefs Tools."""
    import sys

    from neiro.util import subprocess_win

    try:
        proc = subprocess_win.run(
            [sys.executable, "-m", "pip", "install", "verovio"],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    ok = proc.returncode == 0
    return {
        "ok": ok,
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "")[-2000:],
        "stderr": (proc.stderr or "")[-2000:],
        "status": tools_status(),
    }


def set_musescore_path(path: str | None) -> dict:
    """Persist a MuseScore CLI path for Prefs browse / custom install."""
    from neiro.symbolic.score import clear_musescore_override, write_musescore_override

    cleaned = (path or "").strip().strip('"')
    if not cleaned:
        clear_musescore_override()
        return {"ok": True, "path": None, "status": tools_status()}
    from pathlib import Path

    p = Path(cleaned)
    if not p.is_file():
        return {"ok": False, "error": f"not a file: {cleaned}", "status": tools_status()}
    write_musescore_override(str(p.resolve()))
    return {"ok": True, "path": str(p.resolve()), "status": tools_status()}


def _spa_index() -> Path | None:
    candidate = _STATIC_DIR / "index.html"
    if candidate.is_file():
        return candidate
    return None


def _static_file(rel: str) -> Path | None:
    if not rel or ".." in rel.split("/"):
        return None
    target = (_STATIC_DIR / rel).resolve()
    try:
        target.relative_to(_STATIC_DIR.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def _make_handler(state: _State):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:  # quiet by default
            pass

        # -- helpers ---------------------------------------------------------
        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, payload: dict, code: int = 200) -> None:
            self._send(code, json.dumps(payload).encode(), "application/json")

        def _error(self, code: int, message: str) -> None:
            self._json({"error": message}, code)

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length", 0))
            return self.rfile.read(length) if length else b""

        def _query(self) -> dict[str, str]:
            from urllib.parse import parse_qs, urlparse

            return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

        def _ctype_for(self, path: Path) -> str:
            return (
                _MIME.get(path.suffix.lower())
                or mimetypes.guess_type(path.name)[0]
                or ("application/octet-stream")
            )

        def _serve_spa(self) -> None:
            index = _spa_index()
            if index is not None:
                self._send(200, index.read_bytes(), _MIME[".html"])
                return
            # Dev / unpackaged fallback: short notice pointing at the worksuite build.
            if _LEGACY_INDEX.is_file():
                self._send(200, _LEGACY_INDEX.read_bytes(), _MIME[".html"])
                return
            body = (
                b"<!doctype html><title>Neiro</title>"
                b"<p>Neiro UI assets are not built. Run "
                b"<code>cd frontend &amp;&amp; npm run build</code>.</p>"
            )
            self._send(200, body, _MIME[".html"])

        # -- GET ---------------------------------------------------------------
        def do_GET(self) -> None:  # noqa: N802
            from urllib.parse import urlparse

            parsed = urlparse(self.path)
            path = unquote(parsed.path)

            if path in ("/", "/index.html"):
                self._serve_spa()
                return
            if path == "/api/health":
                self._json(
                    {
                        "status": "ok",
                        "version": __version__,
                        "engine": "python-sidecar",
                    }
                )
                return
            if path == "/api/version":
                self._json(
                    {
                        "name": "neiro",
                        "version": __version__,
                        "api_version": _API_VERSION,
                    }
                )
                return
            if path == "/api/tools":
                self._json(tools_status())
                return
            if path.startswith("/api/soundfonts/"):
                from neiro.engine.downloader import default_neiro_home

                name = Path(unquote(path[len("/api/soundfonts/") :])).name
                if not name.lower().endswith(".sf2") or ".." in name:
                    self._error(400, "invalid soundfont name")
                    return
                target = (default_neiro_home() / "soundfonts" / name).resolve()
                sf_root = (default_neiro_home() / "soundfonts").resolve()
                if not str(target).startswith(str(sf_root)) or not target.is_file():
                    self._error(404, "soundfont not found")
                    return
                self._send(200, target.read_bytes(), "application/octet-stream")
                return
            if path.startswith("/api/models"):
                self._handle_models()
                return
            if path == "/api/plugins":
                self._handle_plugins_get()
                return
            if path == "/api/compute":
                from neiro.ui.api_extras import vram_status

                self._json(vram_status(state.vram))
                return
            if path == "/api/session/list":
                from neiro.ui.api_extras import list_sessions

                self._json(list_sessions())
                return
            if path.startswith("/api/plan"):
                self._handle_plan()
                return
            if path.startswith("/api/bulk/"):
                self._handle_bulk(path)
                return
            if path.startswith("/api/notes/"):
                self._handle_notes_get(path)
                return
            if path.startswith("/assets/") or path.startswith("/static/"):
                rel = path.lstrip("/")
                if rel.startswith("static/"):
                    rel = rel[len("static/") :]
                hit = _static_file(rel)
                if hit is None and path.startswith("/assets/"):
                    hit = _static_file(path.lstrip("/"))
                if hit is not None:
                    self._send(200, hit.read_bytes(), self._ctype_for(hit))
                    return
                self._error(404, "not found")
                return
            # Vite-hashed assets at root (favicon, etc.)
            if not path.startswith("/api/") and not path.startswith("/files/"):
                hit = _static_file(path.lstrip("/"))
                if hit is not None:
                    self._send(200, hit.read_bytes(), self._ctype_for(hit))
                    return

            if path.startswith("/api/waveform"):
                self._handle_waveform()
                return
            if path.startswith("/api/spectrogram"):
                self._handle_spectrogram()
                return
            if path.startswith("/api/export"):
                self._handle_export()
                return
            if path.startswith("/api/analyze"):
                self._handle_analyze_get()
                return
            if path == "/api/daw/status":
                from neiro.ui.daw_bridge import default_bridge

                self._json(default_bridge().status())
                return
            if path == "/api/daw/midi":
                from neiro.ui.daw_bridge import default_bridge

                q = self._query()
                after = int(q.get("after_seq", "0") or 0)
                self._json(default_bridge().poll_midi(after))
                return
            if path.startswith("/api/job/"):
                job_id = path.rstrip("/").rsplit("/", 1)[-1]
                payload = job_status(state, job_id)
                if payload is None:
                    self._error(404, "unknown job")
                else:
                    self._json(payload)
                return
            if path.startswith("/api/file/") and path.rstrip("/").endswith("/parent"):
                parts = path.rstrip("/").split("/")
                # /api/file/<id>/parent
                file_id = parts[3] if len(parts) >= 5 else ""
                if not file_id or file_id not in state.files:
                    self._error(404, "unknown file_id")
                    return
                parent = state.parents.get(file_id)
                root = file_id
                seen: set[str] = set()
                while root in state.parents and root not in seen:
                    seen.add(root)
                    root = state.parents[root]
                self._json(
                    {
                        "file_id": file_id,
                        "parent": parent,
                        "original": root if root != file_id else parent,
                    }
                )
                return
            if path == "/api/prefs":
                self._json(state.prefs_snapshot())
                return
            if path.startswith("/files/"):
                rel = path[len("/files/") :]
                target = (state.workspace / rel).resolve()
                if (
                    not str(target).startswith(str(state.workspace.resolve()))
                    or not target.is_file()
                ):
                    self._error(404, "not found")
                    return
                ctype = _MIME.get(target.suffix.lower(), "application/octet-stream")
                self._send(200, target.read_bytes(), ctype)
                return

            # Client-side module routes → SPA
            if _spa_index() is not None and not path.startswith("/api"):
                self._serve_spa()
                return
            self._error(404, "not found")

        # -- POST --------------------------------------------------------------
        def do_POST(self) -> None:  # noqa: N802
            try:
                if self.path == "/api/upload":
                    self._handle_upload()
                elif self.path == "/api/ingest-url":
                    self._handle_ingest_url()
                elif self.path == "/api/edit":
                    self._handle_edit()
                elif self.path == "/api/prefs":
                    self._handle_prefs_update()
                elif self.path == "/api/prefs/flush":
                    self._handle_prefs_flush()
                elif self.path == "/api/plugins":
                    self._handle_plugins_post()
                elif self.path == "/api/compute":
                    self._handle_compute_post()
                elif self.path == "/api/session/save":
                    self._handle_session_save()
                elif self.path == "/api/session/open":
                    self._handle_session_open()
                elif self.path.startswith("/api/notes/"):
                    self._handle_notes_post(self.path)
                elif self.path == "/api/models/download":
                    self._handle_models_download()
                elif self.path == "/api/tools/install":
                    self._handle_tools_install()
                elif self.path == "/api/tools/musescore":
                    self._handle_musescore_path()
                elif self.path.startswith("/api/job/") and self.path.endswith("/cancel"):
                    job_id = self.path.rstrip("/").rsplit("/", 2)[-2]
                    self._handle_cancel(job_id)
                elif self.path in (
                    "/api/separate",
                    "/api/transcribe",
                    "/api/enhance",
                    "/api/pitch_correct",
                ):
                    self._handle_job(self.path.rsplit("/", 1)[-1])
                elif self.path == "/api/daw/capture":
                    self._handle_daw_capture()
                elif self.path.startswith("/api/daw/"):
                    self._handle_daw(self.path)
                else:
                    self._error(404, "not found")
            except Exception as exc:  # surface, don't crash the server
                self._error(500, str(exc))

        def _handle_daw(self, path: str) -> None:
            from neiro.ui.daw_bridge import default_bridge, normalize_module

            bridge = default_bridge()
            body = json.loads(self._read_body() or b"{}")
            if path == "/api/daw/register":
                inst = bridge.register(
                    track_name=str(body.get("track_name", "DAW track")),
                    plugin_role=str(body.get("plugin_role", "injector")),
                    host=str(body.get("host", "unknown")),
                    sample_rate=int(body.get("sample_rate", 44100)),
                    channels=int(body.get("channels", 2)),
                    instance_id=body.get("instance_id"),
                    preferred_module=body.get("preferred_module") or body.get("module"),
                )
                self._json({"ok": True, "instance": inst.to_public(), "status": bridge.status()})
                return
            if path == "/api/daw/unregister":
                iid = str(body.get("instance_id", ""))
                self._json({"ok": bridge.unregister(iid), "status": bridge.status()})
                return
            if path == "/api/daw/heartbeat":
                iid = str(body.get("instance_id", ""))
                ok = bridge.heartbeat(
                    iid,
                    peak=body.get("peak"),
                    frames=int(body.get("frames", 0) or 0),
                    recording=body.get("recording"),
                    preferred_module=body.get("preferred_module") or body.get("module"),
                )
                if not ok:
                    self._error(404, "unknown instance")
                    return
                self._json({"ok": True, "status": bridge.status()})
                return
            if path == "/api/daw/show-ui":
                status = bridge.request_show_ui(
                    body.get("instance_id"),
                    module=normalize_module(str(body.get("module", "learn"))),
                    launch_if_needed=bool(body.get("launch_if_needed", True)),
                )
                # Best-effort open of the single shared window if a client isn't
                # already connected (browser tab or Tauri shell).
                if bridge.consume_launch_request():
                    with contextlib.suppress(Exception):
                        webbrowser.open(f"http://127.0.0.1:{state.port}/")
                self._json({"ok": True, "status": status})
                return
            if path == "/api/daw/midi":
                iid = str(body.get("instance_id", ""))
                try:
                    result = bridge.push_midi(
                        iid,
                        pitch=int(body.get("pitch", 60)),
                        velocity=int(body.get("velocity", 100)),
                        note_on=bool(body.get("note_on", True)),
                    )
                except KeyError:
                    self._error(404, "unknown instance")
                    return
                self._json(result)
                return
            self._error(404, "not found")

        def _handle_daw_capture(self) -> None:
            """Accept a WAV body from a VST injector (Edison-style track dump)."""
            from neiro.io import load_audio
            from neiro.ui.daw_bridge import default_bridge, normalize_module

            bridge = default_bridge()
            iid = (self.headers.get("X-Instance-Id") or "").strip() or None
            module = normalize_module(
                self.headers.get("X-Module") or "separate",
                default="separate",
            )
            name = _safe_name(self.headers.get("X-Filename") or "daw-capture.wav")
            data = self._read_body()
            if not data:
                self._error(400, "empty capture")
                return
            # Soft cap ~80 MB — keeps local Edison-style dumps practical.
            if len(data) > 80 * 1024 * 1024:
                self._error(413, "capture too large (max 80 MB)")
                return
            file_id = uuid.uuid4().hex[:12]
            dest = state.workspace / "uploads" / file_id / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            try:
                load_audio(dest)
            except Exception as exc:
                self._error(422, f"couldn't decode capture {name}: {exc}")
                return
            payload = self._register_analyzed(dest, name)
            status = bridge.publish_capture(
                iid,
                file_payload=payload,
                module=module,
                launch_if_needed=True,
            )
            if bridge.consume_launch_request():
                with contextlib.suppress(Exception):
                    webbrowser.open(f"http://127.0.0.1:{state.port}/")
            self._json({"ok": True, "capture": status.get("last_capture"), "status": status})

        def _handle_prefs_update(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            try:
                self._json(state.update_prefs(body))
            except (TypeError, ValueError) as exc:
                self._error(400, str(exc))

        def _handle_prefs_flush(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            clear_cache = bool(body.get("clear_cache", False))
            self._json(state.flush_compute(clear_cache=clear_cache))

        def _handle_cancel(self, job_id: str) -> None:
            try:
                self._json(cancel_job(state, job_id))
            except KeyError:
                self._error(404, "unknown job")

        def _handle_plugins_get(self) -> None:
            from neiro.engine.user_plugins import discover_plugins

            self._json({"plugins": [plugin.as_dict() for plugin in discover_plugins()]})

        def _handle_plugins_post(self) -> None:
            from neiro.engine.user_plugins import set_plugin_grants

            body = json.loads(self._read_body() or b"{}")
            if isinstance(body.get("grants"), dict):
                updates = {str(key): bool(value) for key, value in body["grants"].items()}
            elif "plugin" in body:
                updates = {str(body["plugin"]): bool(body.get("granted", True))}
            else:
                self._error(400, "expected {'grants': {id: bool}} or {'plugin': id}")
                return
            plugins = set_plugin_grants(updates)
            with state.lock:
                state.registry = default_registry()
            self._json({"ok": True, "plugins": [plugin.as_dict() for plugin in plugins]})

        def _handle_compute_post(self) -> None:
            from neiro.ui.api_extras import flush_vram, vram_status

            body = json.loads(self._read_body() or b"{}")
            action = str(body.get("action", "status"))
            if action == "flush":
                self._json(flush_vram(state.vram))
                return
            self._json(vram_status(state.vram))

        def _handle_session_save(self) -> None:
            from neiro.ui.api_extras import save_session_doc

            body = json.loads(self._read_body() or b"{}")
            name = str(body.get("name") or "untitled")
            file_id = body.get("file_id")
            path = state.files.get(file_id) if file_id else None
            self._json(
                save_session_doc(
                    name=name,
                    file_id=file_id,
                    file_path=path,
                    graph_config=dict(body.get("graph_config") or {}),
                    notes=body.get("notes"),
                )
            )

        def _handle_session_open(self) -> None:
            from neiro.ui.api_extras import open_session_doc

            body = json.loads(self._read_body() or b"{}")
            name = str(body.get("name") or "")
            if not name:
                self._error(400, "name is required")
                return
            try:
                self._json(open_session_doc(name))
            except FileNotFoundError:
                self._error(404, "session not found")
            except Exception as exc:
                self._error(400, str(exc))

        def _handle_plan(self) -> None:
            from neiro.ui.api_extras import plan_payload

            q = self._query()
            file_id = q.get("file_id", "")
            kind = q.get("kind", "separate")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            bleed_raw = q.get("bleed_suppress", "true")
            bleed = bleed_raw.lower() not in {"off", "false", "0", "no"}
            corrections = None
            raw_corr = q.get("corrections")
            if raw_corr:
                try:
                    parsed = json.loads(raw_corr)
                except json.JSONDecodeError:
                    self._error(400, "corrections must be JSON")
                    return
                corrections = _normalize_corrections(parsed)
            try:
                members_raw = q.get("members", "")
                members = [m.strip() for m in members_raw.split(",") if m.strip()] or None
                payload = plan_payload(
                    kind=kind,
                    file_path=state.files[file_id],
                    registry=state.registry,
                    vram=state.vram,
                    preset=q.get("preset", "vocals"),
                    mode=q.get("mode", "auto"),
                    model=q.get("model") or None,
                    members=members,
                    chain=_parse_enhance_chain(q.get("chain")),
                    quality=q.get("quality"),
                    bleed_suppress=bleed,
                    corrections=corrections,
                )
            except Exception as exc:
                self._error(400, str(exc))
                return
            self._json(payload)

        def _handle_bulk(self, path: str) -> None:
            from neiro.dsp import waveform_peaks
            from neiro.ui.api_extras import arrow_table_bytes

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            kind = path.rstrip("/").rsplit("/", 1)[-1]
            accept = (self.headers.get("Accept") or "").lower()
            want_arrow = "application/vnd.apache.arrow" in accept or q.get("format") == "arrow"
            if kind == "waveform":
                width = max(1, min(4000, int(q.get("width", "1200"))))
                start = float(q["start"]) if "start" in q else None
                end = float(q["end"]) if "end" in q else None
                peaks = waveform_peaks(state.load(file_id), width=width, start=start, end=end)
                if want_arrow:
                    raw = arrow_table_bytes(
                        {
                            "min": list(peaks.get("min") or []),
                            "max": list(peaks.get("max") or []),
                        }
                    )
                    if raw is not None:
                        self._send(200, raw, "application/vnd.apache.arrow.stream")
                        return
                self._json(peaks)
                return
            self._error(404, "unknown bulk kind")

        def _handle_notes_get(self, path: str) -> None:
            from neiro.ui.api_extras import notes_to_public

            job_id = path.rstrip("/").rsplit("/", 1)[-1]
            with state.lock:
                sess = state.transcription_sessions.get(job_id)
            if sess is None:
                self._error(404, "no transcription session for job")
                return
            self._json({"job_id": job_id, **notes_to_public(sess)})

        def _handle_notes_post(self, path: str) -> None:
            from neiro.engine.artifacts import NoteEvent
            from neiro.symbolic import write_midi
            from neiro.ui.api_extras import notes_to_public

            job_id = path.rstrip("/").rsplit("/", 1)[-1]
            body = json.loads(self._read_body() or b"{}")
            with state.lock:
                sess = state.transcription_sessions.get(job_id)
            if sess is None:
                self._error(404, "no transcription session for job")
                return
            op = str(body.get("op", "update"))
            track = str(body.get("track") or next(iter(sess.track_names()), "melody"))
            try:
                if op == "add":
                    note = NoteEvent(
                        onset=float(body["onset"]),
                        offset=float(body["offset"]),
                        pitch=int(body["pitch"]),
                        velocity=int(body.get("velocity", 100)),
                        confidence=1.0,
                        user_verified=True,
                    )
                    sess.add_note(track, note)
                elif op == "delete":
                    sess.delete_note(track, int(body["index"]))
                elif op == "update":
                    changes = {
                        k: body[k] for k in ("onset", "offset", "pitch", "velocity") if k in body
                    }
                    if "pitch" in changes:
                        changes["pitch"] = int(changes["pitch"])
                    if "velocity" in changes:
                        changes["velocity"] = int(changes["velocity"])
                    if "onset" in changes:
                        changes["onset"] = float(changes["onset"])
                    if "offset" in changes:
                        changes["offset"] = float(changes["offset"])
                    sess.update_note(track, int(body["index"]), **changes)
                elif op == "quantize":
                    sess.quantize(
                        division=int(body.get("division", 4)),
                        strength=float(body.get("strength", 1.0)),
                        track=str(body["track"]) if body.get("track") else None,
                    )
                else:
                    self._error(400, f"unknown op {op!r}")
                    return
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                self._error(400, str(exc))
                return
            timeline = sess.to_timeline()
            job_dir = state.workspace / "jobs" / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            midi_path = write_midi(timeline, job_dir / "transcription.mid")
            public = notes_to_public(sess)
            with state.lock:
                job = state.jobs.get(job_id)
                if job and isinstance(job.get("result"), dict):
                    job["result"]["tracks"] = public["tracks"]
                    job["result"]["tempo_bpm"] = public["tempo_bpm"]
                    job["result"]["event_count"] = sum(len(v) for v in public["tracks"].values())
                    job["result"]["midi_url"] = f"/files/jobs/{job_id}/{midi_path.name}"
            self._json({"ok": True, "job_id": job_id, **public})

        def _handle_models(self) -> None:
            q = self._query()
            task = q.get("task")
            models = []
            for entry in state.registry.all():
                if task:
                    if task == "transcribe":
                        if (
                            entry.task not in ("transcribe", "transcribe-lyrics")
                            and entry.id != "whisper-lyrics"
                        ):
                            continue
                    elif entry.task != task:
                        continue
                available = entry.available()
                downloaded = entry.downloaded() if available else False
                if not available:
                    status = "needs-install"
                elif entry.needs_download and not downloaded:
                    status = "needs-download"
                else:
                    status = "ready"
                models.append(
                    {
                        "id": entry.id,
                        "task": entry.task,
                        "display_name": entry.display_name,
                        "quality_class": entry.quality_class,
                        "available": available,
                        "downloaded": downloaded,
                        "needs_download": entry.needs_download,
                        "status": status,
                        "requires": list(entry.manifest.get("requires", [])),
                        "license_spdx": entry.license_spdx,
                        "size_hint": _model_size_hint(entry),
                    }
                )
            self._json({"models": models, "packs": {k: list(v) for k, v in MODEL_PACKS.items()}})

        def _handle_models_download(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            ids: list[str] = []
            pack = body.get("pack")
            if pack:
                if pack not in MODEL_PACKS:
                    self._error(400, f"unknown pack {pack!r}; known: {', '.join(MODEL_PACKS)}")
                    return
                ids.extend(MODEL_PACKS[pack])
            raw_ids = body.get("model_ids") or body.get("models")
            if isinstance(raw_ids, list):
                ids.extend(str(x) for x in raw_ids)
            mid = body.get("model_id")
            if mid:
                ids.append(str(mid))
            # Dedupe preserve order
            seen: set[str] = set()
            uniq = []
            for m in ids:
                if m not in seen:
                    seen.add(m)
                    uniq.append(m)
            if not uniq:
                self._error(400, "provide model_id, model_ids, or pack")
                return
            job_id = start_model_download(state, model_ids=uniq)
            self._json({"job_id": job_id, "model_ids": uniq})

        def _handle_tools_install(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            tool = str(body.get("tool") or "").lower()
            if tool == "verovio":
                self._json(install_verovio())
                return
            if tool == "soundfont":
                self._json(install_soundfont())
                return
            self._error(
                400, "supported tools: verovio, soundfont (MuseScore uses /api/tools/musescore)"
            )

        def _handle_musescore_path(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            path = body.get("path")
            self._json(set_musescore_path(None if path is None else str(path)))

        def _handle_waveform(self) -> None:
            from neiro.dsp import waveform_peaks

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            width = max(1, min(4000, int(q.get("width", "1200"))))
            start = float(q["start"]) if "start" in q else None
            end = float(q["end"]) if "end" in q else None
            self._json(waveform_peaks(state.load(file_id), width=width, start=start, end=end))

        def _handle_spectrogram(self) -> None:
            from neiro.dsp import spectrogram_image

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            start = float(q["start"]) if "start" in q else None
            end = float(q["end"]) if "end" in q else None
            self._json(spectrogram_image(state.load(file_id), start=start, end=end))

        def _handle_export(self) -> None:
            from neiro.io import write_audio

            q = self._query()
            file_id = q.get("file_id", "")
            fmt_key = q.get("format", "wav24")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            if fmt_key not in _EXPORT_FORMATS:
                self._error(400, f"unknown format {fmt_key!r}")
                return
            fmt, bit_depth, ctype = _EXPORT_FORMATS[fmt_key]
            audio = state.load(file_id)
            ext = "flac" if fmt == "flac" else "wav"
            out = state.workspace / "exports" / file_id / f"export.{ext}"
            write_audio(audio, out, fmt=fmt, bit_depth=bit_depth)
            self._send(200, out.read_bytes(), ctype)

        def _handle_analyze_get(self) -> None:
            """Re-estimate BPM/key (and related analysis) for an existing file_id."""
            from neiro.analysis import analyze

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            audio = state.load(file_id)
            report = analyze(audio, registry=state.registry)
            self._json(
                {
                    "file_id": file_id,
                    "estimated_bpm": report.estimated_bpm,
                    "estimated_key": report.estimated_key,
                    "report": report.as_dict(),
                }
            )

        def _handle_edit(self) -> None:
            from neiro.dsp import edit as ed
            from neiro.dsp import waveform_peaks

            body = json.loads(self._read_body() or b"{}")
            op = body.get("op", "")

            if op in ("bounce", "combine"):
                tracks = body.get("tracks") or []
                if not isinstance(tracks, list) or not tracks:
                    self._error(400, "bounce requires a non-empty tracks list")
                    return
                layers = []
                parent_ids: list[str] = []
                for i, t in enumerate(tracks):
                    if not isinstance(t, dict):
                        self._error(400, f"tracks[{i}] must be an object")
                        return
                    tid = t.get("file_id", "")
                    if tid not in state.files:
                        self._error(400, f"unknown file_id in tracks[{i}]")
                        return
                    parent_ids.append(tid)
                    layers.append(
                        (
                            state.load(tid),
                            float(t.get("gain", 1.0)),
                            float(t.get("pan", 0.0)),
                            float(t.get("offset", 0.0)),
                        )
                    )
                try:
                    result = ed.bounce(layers)
                except ValueError as exc:
                    self._error(400, str(exc))
                    return
                name = _safe_name("bounce.wav")
                new_id = state.register(name, result)
                if parent_ids:
                    state.parents[new_id] = parent_ids[0]
                self._json(
                    {
                        "file_id": new_id,
                        "parent": parent_ids[0] if parent_ids else "",
                        "parents": parent_ids,
                        "op": "bounce",
                        "audio_url": f"/files/edits/{new_id}/{name}",
                        "duration": result.duration_seconds,
                        "waveform": waveform_peaks(result, width=1200),
                    }
                )
                return

            file_id = body.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            audio = state.load(file_id)
            s, e = body.get("start"), body.get("end")

            if op == "split":
                at = body.get("at", s)
                if at is None:
                    self._error(400, "split requires at (or start)")
                    return
                left, right = ed.split_at(audio, float(at))
                stem = Path(state.files[file_id]).stem
                left_name = _safe_name(f"{stem}.split-L.wav")
                right_name = _safe_name(f"{stem}.split-R.wav")
                left_id = state.register(left_name, left)
                right_id = state.register(right_name, right)
                state.parents[left_id] = file_id
                state.parents[right_id] = file_id
                self._json(
                    {
                        "file_id": left_id,
                        "parent": file_id,
                        "op": "split",
                        "audio_url": f"/files/edits/{left_id}/{left_name}",
                        "duration": left.duration_seconds,
                        "waveform": waveform_peaks(left, width=1200),
                        "left": {
                            "file_id": left_id,
                            "audio_url": f"/files/edits/{left_id}/{left_name}",
                            "duration": left.duration_seconds,
                        },
                        "right": {
                            "file_id": right_id,
                            "audio_url": f"/files/edits/{right_id}/{right_name}",
                            "duration": right.duration_seconds,
                        },
                    }
                )
                return

            if op == "time_stretch":
                rate = body.get("rate", body.get("stretch"))
                if rate is None:
                    self._error(400, "time_stretch requires rate (duration scale; >1 = longer)")
                    return
                try:
                    result = ed.time_stretch(audio, float(rate))
                except ValueError as exc:
                    self._error(400, str(exc))
                    return
                name = _safe_name(Path(state.files[file_id]).stem + ".stretch.wav")
                new_id = state.register(name, result)
                state.parents[new_id] = file_id
                self._json(
                    {
                        "file_id": new_id,
                        "parent": file_id,
                        "op": "time_stretch",
                        "audio_url": f"/files/edits/{new_id}/{name}",
                        "duration": result.duration_seconds,
                        "waveform": waveform_peaks(result, width=1200),
                        "provenance": getattr(result, "provenance", None),
                    }
                )
                return

            if op == "pitch_shift":
                semis = body.get("semitones", body.get("semitone"))
                if semis is None:
                    self._error(400, "pitch_shift requires semitones")
                    return
                try:
                    result = ed.pitch_shift(audio, float(semis))
                except ValueError as exc:
                    self._error(400, str(exc))
                    return
                name = _safe_name(Path(state.files[file_id]).stem + ".pitch.wav")
                new_id = state.register(name, result)
                state.parents[new_id] = file_id
                self._json(
                    {
                        "file_id": new_id,
                        "parent": file_id,
                        "op": "pitch_shift",
                        "audio_url": f"/files/edits/{new_id}/{name}",
                        "duration": result.duration_seconds,
                        "waveform": waveform_peaks(result, width=1200),
                        "provenance": getattr(result, "provenance", None),
                    }
                )
                return

            if op == "pitch_correct":
                key = body.get("key")
                strength = body.get("strength", 1.0)
                try:
                    result = ed.pitch_correct(
                        audio,
                        key=str(key) if key else None,
                        strength=float(strength),
                    )
                except ValueError as exc:
                    self._error(400, str(exc))
                    return
                name = _safe_name(Path(state.files[file_id]).stem + ".pitch-correct.wav")
                new_id = state.register(name, result)
                state.parents[new_id] = file_id
                self._json(
                    {
                        "file_id": new_id,
                        "parent": file_id,
                        "op": "pitch_correct",
                        "audio_url": f"/files/edits/{new_id}/{name}",
                        "duration": result.duration_seconds,
                        "waveform": waveform_peaks(result, width=1200),
                        "provenance": getattr(result, "provenance", None),
                    }
                )
                return

            ops = {
                "trim": lambda a: ed.trim(a, s, e),
                "delete": lambda a: ed.delete_region(a, s, e),
                "silence": lambda a: ed.silence_region(a, s, e),
                "fade_in": lambda a: ed.fade(a, s, e, direction="in"),
                "fade_out": lambda a: ed.fade(a, s, e, direction="out"),
                "gain": lambda a: ed.gain(a, float(body.get("db", 0.0)), s, e),
                "reverse": ed.reverse,
                "normalize": lambda a: ed.normalize(a, float(body.get("target_dbfs", -1.0))),
            }
            if op not in ops:
                self._error(400, f"unknown edit op {op!r}")
                return
            if op in ("trim", "delete", "silence", "fade_in", "fade_out") and (
                s is None or e is None
            ):
                self._error(400, f"{op} requires a selection")
                return
            result = ops[op](audio)
            name = _safe_name(Path(state.files[file_id]).stem + f".{op}.wav")
            new_id = state.register(name, result)
            state.parents[new_id] = file_id
            self._json(
                {
                    "file_id": new_id,
                    "parent": file_id,
                    "op": op,
                    "audio_url": f"/files/edits/{new_id}/{name}",
                    "duration": result.duration_seconds,
                    "waveform": waveform_peaks(result, width=1200),
                }
            )

        def _register_analyzed(self, dest: Path, display_name: str) -> dict:
            from neiro.analysis import analyze
            from neiro.io import load_audio

            audio = load_audio(dest)
            report = analyze(audio, registry=state.registry)
            file_id = uuid.uuid4().hex[:12]
            state.files[file_id] = dest
            return {
                "file_id": file_id,
                "name": display_name,
                "audio_url": f"/files/{dest.relative_to(state.workspace).as_posix()}",
                "report": report.as_dict(),
            }

        def _handle_ingest_url(self) -> None:
            body = json.loads(self._read_body() or b"{}")
            url = (body.get("url") or "").strip()
            if not url:
                self._error(400, "url is required")
                return
            try:
                from neiro.io.url_ingest import fetch_url_audio, is_url

                if not is_url(url):
                    self._error(400, "url must start with http:// or https://")
                    return
                cached = fetch_url_audio(url)
                file_id = uuid.uuid4().hex[:12]
                name = _safe_name(cached.stem + ".wav")
                dest = state.workspace / "uploads" / file_id / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(cached.read_bytes())
                self._json(self._register_analyzed(dest, name))
            except RuntimeError as exc:
                self._error(422, str(exc))
            except ValueError as exc:
                self._error(400, str(exc))

        def _handle_upload(self) -> None:
            from neiro.io import load_audio

            name = _safe_name(self.headers.get("X-Filename", "upload.wav"))
            data = self._read_body()
            if not data:
                self._error(400, "empty upload")
                return
            file_id = uuid.uuid4().hex[:12]
            dest = state.workspace / "uploads" / file_id / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            try:
                load_audio(dest)
            except Exception as exc:
                self._error(422, f"couldn't decode {name}: {exc}")
                return
            self._json(self._register_analyzed(dest, name))

        def _handle_job(self, kind: str) -> None:
            body = json.loads(self._read_body() or b"{}")
            file_id = body.get("file_id", "")
            try:
                job_id = start_job(state, kind, file_id, body)
            except KeyError as exc:
                self._error(400, str(exc))
                return
            self._json({"job_id": job_id})

    return Handler


def _start_ws_control_plane(state: _State, ws_port: int) -> None:
    """Start the optional WS JSON-RPC control channel alongside the HTTP server.

    Runs in its own thread with its own asyncio event loop so it can't block
    or be blocked by ``ThreadingHTTPServer.serve_forever()``; degrades to a
    printed note (never a crash) when ``websockets`` isn't installed, since
    the REST API in this module is fully functional without it either way.
    """
    from neiro.ui.ws_server import ProgressHub, build_dispatcher, serve_ws, websockets_available

    if not websockets_available():
        print(
            f"WS control channel requested (--ws-port {ws_port}) but the optional "
            "'websockets' package isn't installed; REST API remains fully available."
        )
        return

    hub = ProgressHub()
    state.ws_hub = hub
    dispatcher = build_dispatcher(
        start_job=lambda kind, file_id, body: start_job(state, kind, file_id, body),
        job_status=lambda job_id: job_status(state, job_id),
        cancel_job=lambda job_id: cancel_job(state, job_id),
    )

    def _run() -> None:
        import asyncio

        asyncio.run(serve_ws("127.0.0.1", ws_port, dispatcher, hub))

    threading.Thread(target=_run, daemon=True).start()
    print(f"WS control channel at ws://127.0.0.1:{ws_port}/")


def serve(port: int = 8377, open_browser: bool = True, ws_port: int | None = None) -> int:
    state = _State()
    state.port = port
    server = ThreadingHTTPServer(("127.0.0.1", port), _make_handler(state))
    url = f"http://127.0.0.1:{port}/"
    print(f"Neiro interface at {url} (local only — Ctrl+C to stop)")
    print(f"Workspace: {state.workspace}")
    if ws_port is not None:
        _start_ws_control_plane(state, ws_port)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0
