"""Integration tests for the local UI server.

Starts the real server on an ephemeral port and drives the HTTP API the browser
uses, so the request routing, job lifecycle, and path-safety checks are exercised.
"""

import io
import json
import math
import struct
import threading
import time
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer

import pytest

from neiro.ui.server import _make_handler, _State


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


def _tone_wav_bytes(freq=220.0, seconds=1.0, sr=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(
            struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * n / sr)))
            for n in range(int(seconds * sr))
        )
        w.writeframes(frames)
    return buf.getvalue()


def _get(url):
    with urllib.request.urlopen(url) as resp:
        return resp.status, resp.read()


def _post(url, data, headers):
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def _upload(base, data=None):
    return _post(
        base + "/api/upload",
        data or _tone_wav_bytes(),
        {"X-Filename": "tone.wav"},
    )


def _run_job(base, kind, body):
    job = _post(
        base + "/api/" + kind,
        json.dumps(body).encode(),
        {"Content-Type": "application/json"},
    )
    for _ in range(100):
        status = json.loads(_get(base + "/api/job/" + job["job_id"])[1])
        if status["status"] in ("done", "error"):
            return status
        time.sleep(0.1)
    raise AssertionError("job did not finish in time")


def test_health_and_version_contract(server):
    base, _ = server
    health = json.loads(_get(base + "/api/health")[1])
    assert health["status"] == "ok"
    assert "version" in health
    assert health["engine"] == "python-sidecar"
    ver = json.loads(_get(base + "/api/version")[1])
    assert ver["name"] == "neiro"
    assert isinstance(ver["api_version"], int)
    assert ver["version"] == health["version"]


def test_index_served(server):
    base, _ = server
    status, body = _get(base + "/")
    assert status == 200
    assert b"<title>Neiro" in body


def test_export_formats(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    for fmt in ("wav16", "wav24", "flac"):
        code, body = _get(base + f"/api/export?file_id={fid}&format={fmt}")
        assert code == 200
        assert len(body) > 44


def test_waveform_time_range(server):
    base, _ = server
    fid = _upload(base, _tone_wav_bytes(seconds=2.0))["file_id"]
    wf = json.loads(_get(base + f"/api/waveform?file_id={fid}&width=100&start=0.5&end=1.5")[1])
    assert wf["width"] == 100
    assert abs(wf["duration"] - 2.0) < 0.05
    assert len(wf["max"]) == 100


def test_upload_returns_analysis(server):
    base, _ = server
    data = _upload(base)
    assert "file_id" in data
    assert data["report"]["sample_rate"] == 16000
    assert data["audio_url"].startswith("/files/uploads/")


def test_ingest_url_mocked(server, monkeypatch, tmp_path):
    base, state = server
    wav = tmp_path / "cached.wav"
    wav.write_bytes(_tone_wav_bytes())

    monkeypatch.setattr(
        "neiro.io.url_ingest.fetch_url_audio",
        lambda url, **kw: wav,
    )

    data = _post(
        base + "/api/ingest-url",
        json.dumps({"url": "https://example.com/watch?v=1"}).encode(),
        {"Content-Type": "application/json"},
    )
    assert data["file_id"] in state.files
    assert data["report"]["sample_rate"] == 16000


def test_separation_job_lifecycle(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    status = _run_job(base, "separate", {"file_id": fid, "preset": "vocals"})
    assert status["status"] == "done"
    names = {f["name"] for f in status["result"]["files"]}
    assert {"vocals", "instrumental", "residual"} <= names
    # The served stem is fetchable and is a real WAV.
    stem_url = status["result"]["files"][0]["url"]
    code, body = _get(base + stem_url)
    assert code == 200 and body[:4] == b"RIFF"


def test_transcription_job(server):
    base, _ = server
    # A melody the mono YIN tracker can follow.
    parts = []
    sr = 16000
    for freq in (261.63, 392.0):
        frames = b"".join(
            struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * n / sr)))
            for n in range(int(0.5 * sr))
        )
        parts.append(frames)
        parts.append(b"\x00\x00" * int(0.1 * sr))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(parts))
    fid = _upload(base, buf.getvalue())["file_id"]
    status = _run_job(base, "transcribe", {"file_id": fid, "mode": "direct", "model": "dsp-yin"})
    assert status["status"] == "done"
    assert status["result"]["event_count"] >= 1
    assert status["result"]["midi_url"].endswith(".mid")


def test_unknown_file_id_rejected(server):
    base, _ = server
    with pytest.raises(urllib.error.HTTPError) as exc:
        _post(
            base + "/api/separate",
            json.dumps({"file_id": "deadbeef"}).encode(),
            {"Content-Type": "application/json"},
        )
    assert exc.value.code == 400


def test_path_traversal_blocked(server):
    base, _ = server
    # A traversal attempt outside the workspace must 404, not read the filesystem.
    with pytest.raises(urllib.error.HTTPError) as exc:
        _get(base + "/files/../../../../etc/passwd")
    assert exc.value.code == 404


def test_unknown_job_is_404(server):
    base, _ = server
    with pytest.raises(urllib.error.HTTPError) as exc:
        _get(base + "/api/job/nonexistent")
    assert exc.value.code == 404


# ---- editor endpoints -------------------------------------------------------


def test_waveform_and_spectrogram(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    wf = json.loads(_get(base + "/api/waveform?file_id=" + fid + "&width=300")[1])
    assert wf["width"] == 300
    assert len(wf["max"]) == 300
    spec = json.loads(_get(base + "/api/spectrogram?file_id=" + fid)[1])
    assert spec["rows"] * spec["cols"] == len(spec["data"])


def test_edit_trim_creates_new_file(server):
    base, _ = server
    up = _upload(base, _tone_wav_bytes(seconds=2.0))
    fid = up["file_id"]
    res = _post(
        base + "/api/edit",
        json.dumps({"file_id": fid, "op": "trim", "start": 0.5, "end": 1.5}).encode(),
        {"Content-Type": "application/json"},
    )
    assert res["file_id"] != fid
    assert res["parent"] == fid
    assert abs(res["duration"] - 1.0) < 0.02
    # The edited audio is fetchable.
    code, body = _get(base + res["audio_url"])
    assert code == 200 and body[:4] == b"RIFF"


def test_edit_requires_selection_for_trim(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    with pytest.raises(urllib.error.HTTPError) as exc:
        _post(
            base + "/api/edit",
            json.dumps({"file_id": fid, "op": "trim"}).encode(),
            {"Content-Type": "application/json"},
        )
    assert exc.value.code == 400


def test_edit_reverse_and_normalize(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    for op in ("reverse", "normalize"):
        res = _post(
            base + "/api/edit",
            json.dumps({"file_id": fid, "op": op}).encode(),
            {"Content-Type": "application/json"},
        )
        assert "waveform" in res
        fid = res["file_id"]  # chain edits


def test_edit_unknown_op_rejected(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    with pytest.raises(urllib.error.HTTPError) as exc:
        _post(
            base + "/api/edit",
            json.dumps({"file_id": fid, "op": "explode"}).encode(),
            {"Content-Type": "application/json"},
        )
    assert exc.value.code == 400
