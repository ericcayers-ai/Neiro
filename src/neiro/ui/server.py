"""Local HTTP server for the Neiro interface.

Standard library only, bound to 127.0.0.1 — nothing is exposed to the network
and no audio leaves the machine (roadmap principle 2). The browser page is a
thin client over the same planner/graph engine as the CLI.

Endpoints:
    GET  /                      the interface
    POST /api/upload            raw audio bytes (X-Filename header) -> analysis
    POST /api/ingest-url        {url}               -> analysis (yt-dlp)
    POST /api/separate          {file_id, preset}   -> job id
    POST /api/transcribe        {file_id, mode}     -> job id
    POST /api/enhance           {file_id}           -> job id
    GET  /api/job/<id>          job status, progress lines, result
    GET  /api/waveform          ?file_id&width      -> min/max peak envelope
    GET  /api/spectrogram       ?file_id            -> quantised log-freq grid
    POST /api/edit              {file_id, op, ...}  -> new (edited) file_id
    GET  /files/<...>           artifacts (stems, MIDI, edits) from the workspace
"""

from __future__ import annotations

import json
import re
import tempfile
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import CancelledError, ExecutionContext, Progress
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager

__all__ = ["serve"]

_MIME = {
    ".html": "text/html; charset=utf-8",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mid": "audio/midi",
    ".json": "application/json",
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
        self.lock = threading.Lock()

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


def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name).name)
    return base or "upload.wav"


def _job_progress(state: _State, job_id: str):
    def _cb(prog: Progress) -> None:
        line = f"{prog.node_id}: {prog.stage}" + (f" — {prog.message}" if prog.message else "")
        with state.lock:
            job = state.jobs.get(job_id)
            if job is not None:
                job["progress"].append(line)

    return _cb


def _run_separation(state: _State, job_id: str, file_id: str, preset: str) -> None:
    import numpy as np

    from neiro.engine.planner import plan_separation
    from neiro.io import write_audio, write_export_metadata

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_separation(state.files[file_id], preset, state.registry, state.vram)
    ctx = ExecutionContext(cache=state.cache, progress=_job_progress(state, job_id))
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
        files.append(
            {
                "name": name,
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
        files.append({"name": "residual", "url": f"/files/jobs/{job_id}/{p.name}"})
        result["null_test_db"] = round(float(20 * np.log10(resid.peak() + 1e-12)), 1)
    with state.lock:
        state.jobs[job_id].update(status="done", result=result)


def _run_transcription(
    state: _State, job_id: str, file_id: str, mode: str, model: str | None
) -> None:
    from neiro.engine.planner import plan_transcription
    from neiro.symbolic import write_midi

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_transcription(
        state.files[file_id], state.registry, state.vram, mode=mode, model=model
    )
    ctx = ExecutionContext(cache=state.cache, progress=_job_progress(state, job_id))
    with state.lock:
        state.job_contexts[job_id] = ctx
    try:
        outputs = plan.graph.execute(ctx, targets=[plan.compile_node])
    finally:
        with state.lock:
            state.job_contexts.pop(job_id, None)
    timeline = outputs[plan.compile_node]["timeline"]

    midi_path = write_midi(timeline, job_dir / "transcription.mid")
    tracks = {
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
    }
    with state.lock:
        state.jobs[job_id].update(
            status="done",
            result={
                "model": plan.model_id,
                "used_split": plan.used_split,
                "notes": plan.notes,
                "tempo_bpm": timeline.tempo_bpm,
                "event_count": timeline.total_events(),
                "midi_url": f"/files/jobs/{job_id}/{midi_path.name}",
                "tracks": tracks,
            },
        )


def _run_enhancement(state: _State, job_id: str, file_id: str, chain: list[str] | None) -> None:
    from neiro.engine.planner import plan_enhancement
    from neiro.io import write_audio

    job_dir = state.workspace / "jobs" / job_id
    plan = plan_enhancement(state.files[file_id], state.registry, state.vram, chain=chain)
    result: dict = {"chain": plan.chain, "notes": plan.notes}
    if plan.chain:
        ctx = ExecutionContext(cache=state.cache, progress=_job_progress(state, job_id))
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
        result["file_url"] = f"/files/jobs/{job_id}/{p.name}"
    with state.lock:
        state.jobs[job_id].update(status="done", result=result)


_RUNNERS = {
    "separate": _run_separation,
    "transcribe": _run_transcription,
    "enhance": _run_enhancement,
}


def _parse_enhance_chain(raw) -> list[str] | None:
    if raw is None or raw == "" or raw == "auto":
        return None
    if isinstance(raw, list):
        return raw
    return [s.strip() for s in str(raw).split(",") if s.strip()]


def _make_handler(state: _State):
    index_path = Path(__file__).resolve().parent / "index.html"

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

        # -- GET ---------------------------------------------------------------
        def do_GET(self) -> None:  # noqa: N802
            if self.path in ("/", "/index.html"):
                self._send(200, index_path.read_bytes(), _MIME[".html"])
                return
            if self.path.startswith("/api/waveform"):
                self._handle_waveform()
                return
            if self.path.startswith("/api/spectrogram"):
                self._handle_spectrogram()
                return
            if self.path.startswith("/api/job/"):
                job_id = self.path.rstrip("/").rsplit("/", 1)[-1]
                with state.lock:
                    job = state.jobs.get(job_id)
                    payload = (
                        None
                        if job is None
                        else {
                            "status": job["status"],
                            "kind": job["kind"],
                            "progress": list(job["progress"]),
                            "result": job.get("result"),
                            "error": job.get("error"),
                        }
                    )
                if payload is None:
                    self._error(404, "unknown job")
                else:
                    self._json(payload)
                return
            if self.path.startswith("/files/"):
                rel = self.path[len("/files/") :]
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
                elif self.path.startswith("/api/job/") and self.path.endswith("/cancel"):
                    job_id = self.path.rstrip("/").rsplit("/", 2)[-2]
                    self._handle_cancel(job_id)
                elif self.path in ("/api/separate", "/api/transcribe", "/api/enhance"):
                    self._handle_job(self.path.rsplit("/", 1)[-1])
                else:
                    self._error(404, "not found")
            except Exception as exc:  # surface, don't crash the server
                self._error(500, str(exc))

        def _handle_cancel(self, job_id: str) -> None:
            with state.lock:
                ctx = state.job_contexts.get(job_id)
                job = state.jobs.get(job_id)
            if job is None:
                self._error(404, "unknown job")
                return
            if ctx is not None:
                ctx.cancel()
            with state.lock:
                if job.get("status") == "running":
                    state.jobs[job_id].update(status="cancelled", error="cancelled by user")
            self._json({"job_id": job_id, "status": "cancelled"})

        def _handle_waveform(self) -> None:
            from neiro.dsp import waveform_peaks

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            width = max(1, min(4000, int(q.get("width", "1200"))))
            self._json(waveform_peaks(state.load(file_id), width=width))

        def _handle_spectrogram(self) -> None:
            from neiro.dsp import spectrogram_image

            q = self._query()
            file_id = q.get("file_id", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            self._json(spectrogram_image(state.load(file_id)))

        def _handle_edit(self) -> None:
            from neiro.dsp import edit as ed

            body = json.loads(self._read_body() or b"{}")
            file_id = body.get("file_id", "")
            op = body.get("op", "")
            if file_id not in state.files:
                self._error(400, "unknown file_id")
                return
            audio = state.load(file_id)
            s, e = body.get("start"), body.get("end")
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
            from neiro.dsp import waveform_peaks

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
            report = analyze(audio)
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
            if file_id not in state.files:
                self._error(400, "unknown file_id — upload first")
                return
            job_id = uuid.uuid4().hex[:12]
            with state.lock:
                state.jobs[job_id] = {"status": "running", "kind": kind, "progress": []}
            args = {
                "separate": (body.get("preset", "vocals"),),
                "transcribe": (body.get("mode", "auto"), body.get("model")),
                "enhance": (_parse_enhance_chain(body.get("chain")),),
            }[kind]

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
            self._json({"job_id": job_id})

    return Handler


def serve(port: int = 8377, open_browser: bool = True) -> int:
    state = _State()
    server = ThreadingHTTPServer(("127.0.0.1", port), _make_handler(state))
    url = f"http://127.0.0.1:{port}/"
    print(f"Neiro interface at {url} (local only — Ctrl+C to stop)")
    print(f"Workspace: {state.workspace}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0
