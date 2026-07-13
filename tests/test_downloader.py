"""Tests for the model download manager and registry download-state logic.

These never touch the network: HTTP fetches are served by a local throwaway
server, and the registry tests use a synthetic manifest with a weight pointed at
that server. The real neural adapters are exercised separately (and skipped when
their heavy dependencies or downloaded weights are absent).
"""

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from neiro.engine.downloader import (
    DownloadProgress,
    default_models_dir,
    default_neiro_home,
    fetch_http,
    verify_sha256,
)
from neiro.engine.registry import ModelEntry


@pytest.fixture
def file_server():
    """Serve a fixed payload, supporting HTTP Range for resume tests."""
    payload = b"NEIRO-TEST-WEIGHTS-" + bytes(range(256)) * 8  # ~2 KB, deterministic

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            rng = self.headers.get("Range")
            start = 0
            if rng and rng.startswith("bytes="):
                start = int(rng.split("=")[1].split("-")[0])
            body = payload[start:]
            self.send_response(206 if start else 200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{port}/weights.bin", payload
    finally:
        srv.shutdown()
        srv.server_close()


def test_default_dirs_are_outside_repo(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_HOME", str(tmp_path / "neiro-home"))
    assert default_neiro_home() == tmp_path / "neiro-home"
    md = default_models_dir()
    assert md.exists() and md.name == "models"


def test_fetch_http_downloads_and_verifies(file_server, tmp_path):
    url, payload = file_server
    sha = hashlib.sha256(payload).hexdigest()
    dest = tmp_path / "w.bin"
    events = []
    fetch_http(url, dest, model_id="t", sha256=sha, progress=events.append)
    assert dest.read_bytes() == payload
    assert verify_sha256(dest, sha)
    assert events and events[-1].stage == "done"


def test_fetch_http_rejects_bad_checksum(file_server, tmp_path):
    url, _ = file_server
    dest = tmp_path / "w.bin"
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        fetch_http(url, dest, model_id="t", sha256="00" * 32)
    assert not dest.exists()  # corrupt file discarded
    assert not dest.with_suffix(".bin.part").exists()


def test_fetch_http_skips_when_present(file_server, tmp_path):
    url, payload = file_server
    sha = hashlib.sha256(payload).hexdigest()
    dest = tmp_path / "w.bin"
    fetch_http(url, dest, sha256=sha)
    mtime = dest.stat().st_mtime_ns
    # Second call verifies the existing file and returns without rewriting.
    fetch_http(url, dest, sha256=sha)
    assert dest.stat().st_mtime_ns == mtime


def test_fetch_http_resumes_partial(file_server, tmp_path):
    url, payload = file_server
    dest = tmp_path / "w.bin"
    part = dest.with_suffix(".bin.part")
    part.write_bytes(payload[:100])  # simulate an interrupted download
    fetch_http(url, dest, model_id="t")
    assert dest.read_bytes() == payload


def test_download_progress_fraction():
    assert DownloadProgress("m", 50, 100).fraction == 0.5
    assert DownloadProgress("m", 50, None).fraction is None
    assert DownloadProgress("m", 999, 100).fraction == 1.0  # clamped


# ---- registry download-state via a synthetic manifest -----------------------


def _http_manifest(url: str, sha: str) -> dict:
    return {
        "manifest_version": 2,
        "id": "test-http-model",
        "task": "enhance",
        "display_name": "Test HTTP model",
        # Points at a real, importable, dependency-free adapter so available()==True.
        "adapter": "neiro.adapters.dsp_enhancers:NormalizeEnhancer",
        "weights": [{"kind": "http", "dest": "w.bin", "url": url, "sha256": sha}],
        "license": {"spdx": "MIT"},
    }


def test_registry_entry_download_lifecycle(file_server, tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_HOME", str(tmp_path / "home"))
    url, payload = file_server
    sha = hashlib.sha256(payload).hexdigest()
    entry = ModelEntry(_http_manifest(url, sha))

    assert entry.needs_download
    assert not entry.downloaded()
    assert entry.available()  # NormalizeEnhancer has no heavy deps

    ok = entry.ensure_downloaded()
    assert ok
    assert entry.downloaded()  # marker written
    # Weight landed under the unified models dir for this id.
    assert (default_models_dir() / entry.id / "w.bin").read_bytes() == payload


def test_weightless_model_is_always_downloaded(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_HOME", str(tmp_path / "home"))
    manifest = {
        "id": "weightless",
        "task": "enhance",
        "adapter": "neiro.adapters.dsp_enhancers:NormalizeEnhancer",
        "license": {"spdx": "MIT"},
    }
    entry = ModelEntry(manifest)
    assert not entry.needs_download
    assert entry.downloaded()


def test_manifests_all_parse_and_have_licenses():
    """Every shipped manifest is valid JSON with the required fields."""
    from neiro.engine.registry import default_registry

    reg = default_registry()
    assert len(reg.all()) >= 15
    for e in reg.all():
        assert e.id and e.task in {"separate", "transcribe", "enhance", "analyze"}
        assert e.license_spdx  # never empty — licensing is a first-class field
        # A model that declares weights must declare how to fetch them.
        for w in e.weights:
            assert w.get("kind") in {"http", "hf_hub", "managed"}
