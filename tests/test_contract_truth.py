"""Truth contracts fixed in Phase 0.

* auto-enhance reports an explicit no-op instead of "done" with no artefact;
* session notes are a scalar with a 5,000-character cap (no character list);
* ``verify_models.py`` uses the current interpreter, not ``neiro`` on PATH;
* long DSP edits are queued jobs with progress, cancel and a result cache.
"""

from __future__ import annotations

import importlib.util
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from neiro.engine.session import USER_NOTES_LIMIT, SessionDocument, SessionStore
from neiro.ui.server import _make_handler, _run_enhancement, _State, start_edit_job

ROOT = Path(__file__).resolve().parents[1]


def _tone(path: Path, seconds: float = 0.6, sr: int = 16000, freq: float = 220.0) -> Path:
    t = np.arange(int(seconds * sr)) / sr
    x = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    sf.write(path, x, sr)
    return path


def _wait(state: _State, job_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with state.lock:
            job = dict(state.jobs[job_id])
        if job["status"] in {"done", "error", "cancelled"}:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


# ------------------------------------------------------------------ auto-enhance


def test_enhance_empty_chain_is_explicit_noop(tmp_path):
    state = _State()
    fid = state.register_path(_tone(tmp_path / "tone.wav"))
    with state.lock:
        state.jobs["job"] = {
            "status": "running",
            "kind": "enhance",
            "progress": [],
            "progress_events": [],
        }
    _run_enhancement(state, "job", fid, [])
    job = state.jobs["job"]
    assert job["status"] == "done"
    assert job["result"]["noop"] is True
    assert job["result"]["reason"]
    assert "file_id" not in job["result"]
    assert job["result"]["chain"] == []


@pytest.fixture
def server():
    state = _State()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(state))
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", state
    finally:
        srv.shutdown()
        srv.server_close()


def _token(base: str) -> str:
    with urllib.request.urlopen(base + "/api/auth/token") as resp:
        return json.load(resp)["token"]


def _post(base, path, body, token):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Neiro-Token": token},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def _upload(base, token, payload: bytes, name: str = "tone.wav"):
    req = urllib.request.Request(
        base + "/api/upload",
        data=payload,
        headers={
            "Content-Type": "application/octet-stream",
            "X-Filename": name,
            "X-Neiro-Token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def test_enhance_noop_over_http(server, tmp_path):
    base, state = server
    token = _token(base)
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    fid = _upload(base, token, buf.getvalue())["file_id"]

    job = _post(base, "/api/enhance", {"file_id": fid, "chain": ""}, token)
    deadline = time.time() + 30
    status = {}
    while time.time() < deadline:
        with urllib.request.urlopen(base + "/api/job/" + job["job_id"]) as resp:
            status = json.load(resp)
        if status["status"] in {"done", "error"}:
            break
        time.sleep(0.05)
    assert status["status"] == "done"
    assert status["result"]["noop"] is True
    assert "file_id" not in status["result"]


# ------------------------------------------------------------------------ notes


def test_session_notes_scalar_round_trip(tmp_path, monkeypatch):
    from neiro.engine import session as session_mod

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    text = "Practise bars 8-16 at 90 BPM.\nSecond line with unicode: ♪"
    doc = SessionDocument(name="notes-demo", user_notes=text)
    store = SessionStore()
    path = store.save(doc)
    reopened = store.load(path)
    assert reopened.user_notes == text
    assert reopened.notes == []


def test_session_notes_cap_round_trip(tmp_path, monkeypatch):
    from neiro.engine import session as session_mod
    from neiro.ui.api_extras import save_session_doc

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    text = "n" * USER_NOTES_LIMIT
    out = save_session_doc(
        name="cap",
        file_id=None,
        file_path=None,
        graph_config={},
        notes=text,
    )
    assert out["session"]["user_notes"] == text
    with pytest.raises(ValueError):
        save_session_doc(
            name="over",
            file_id=None,
            file_path=None,
            graph_config={},
            notes="n" * (USER_NOTES_LIMIT + 1),
        )
    with pytest.raises(ValueError):
        save_session_doc(
            name="list",
            file_id=None,
            file_path=None,
            graph_config={},
            notes=["not", "a", "string"],
        )


def test_legacy_char_list_migrates_to_scalar(tmp_path, monkeypatch):
    from neiro.engine import session as session_mod

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    store = SessionStore()
    path = store.path_for("legacy")
    path.write_text(
        json.dumps({"name": "legacy", "notes": list("audit note")}),
        encoding="utf-8",
    )
    doc = store.load(path)
    assert doc.user_notes == "audit note"
    assert doc.notes == []


def test_notes_over_http_round_trip(server, monkeypatch, tmp_path):
    from neiro.engine import session as session_mod

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    base, _ = server
    token = _token(base)
    text = "x" * 4000
    saved = _post(base, "/api/session/save", {"name": "http-notes", "notes": text}, token)
    assert saved["session"]["user_notes"] == text
    opened = _post(base, "/api/session/open", {"name": "http-notes"}, token)
    assert opened["session"]["user_notes"] == text


# ----------------------------------------------------------------- verify_models


def test_verify_models_uses_current_interpreter(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "neiro_verify_models", ROOT / "scripts" / "verify_models.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        return SimpleNamespace(stdout="dsp-yin\n", returncode=0)

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    out = module.cli_models_output()
    assert out == "dsp-yin\n"
    assert calls and calls[0][1:] == ["-m", "neiro.cli", "models"]
    assert calls[0][0].endswith(("python.exe", "python"))


# ------------------------------------------------------------------ queued edits


def test_queued_time_stretch_job_and_cache(tmp_path):
    state = _State()
    fid = state.register_path(_tone(tmp_path / "tone.wav", seconds=0.5))
    job_id = start_edit_job(state, fid, {"op": "time_stretch", "rate": 2.0})
    job = _wait(state, job_id)
    assert job["status"] == "done", job
    result = job["result"]
    assert result["file_id"] in state.files
    assert result["op"] == "time_stretch"
    assert result["method"]
    assert result["duration"] > 0.9
    assert job["progress"], "queued job must report progress"

    again = start_edit_job(state, fid, {"op": "time_stretch", "rate": 2.0})
    cached = _wait(state, again)
    assert cached["status"] == "done"
    assert cached["result"]["cached"] is True
    assert cached["result"]["file_id"] == result["file_id"]


def test_queued_edit_rejects_bad_params(tmp_path):
    state = _State()
    fid = state.register_path(_tone(tmp_path / "tone.wav"))
    with pytest.raises(ValueError):
        start_edit_job(state, fid, {"op": "trim"})
    with pytest.raises(ValueError):
        start_edit_job(state, fid, {"op": "time_stretch"})
    with pytest.raises(KeyError):
        start_edit_job(state, "missing", {"op": "time_stretch", "rate": 1.5})


def test_session_export_returns_the_document(server, monkeypatch, tmp_path):
    from neiro.engine import session as session_mod

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    base, _ = server
    token = _token(base)
    _post(base, "/api/session/save", {"name": "exported", "notes": "keep me"}, token)
    with urllib.request.urlopen(base + "/api/session/export?name=exported") as resp:
        payload = json.load(resp)
    assert payload["name"] == "exported"
    assert payload["user_notes"] == "keep me"
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(base + "/api/session/export?name=missing")
    assert exc.value.code == 404
