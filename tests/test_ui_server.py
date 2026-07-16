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


def test_models_transcribe_status(server):
    base, _ = server
    payload = json.loads(_get(base + "/api/models?task=transcribe")[1])
    assert "models" in payload
    ids = {m["id"] for m in payload["models"]}
    assert "dsp-yin" in ids
    assert "tr-ensemble-default" in ids
    yin = next(m for m in payload["models"] if m["id"] == "dsp-yin")
    assert yin["status"] == "ready"
    assert yin["available"] is True


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
    assert status["result"]["musicxml_url"].endswith(".musicxml")
    assert status["result"]["provenance_url"].endswith(".meta.json")
    code, body = _get(base + status["result"]["musicxml_url"])
    assert code == 200 and b"score-partwise" in body
    code, meta = _get(base + status["result"]["provenance_url"])
    assert code == 200 and b"model_id" in meta


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
    window = json.loads(_get(base + "/api/spectrogram?file_id=" + fid + "&start=0.1&end=0.5")[1])
    assert window["rows"] * window["cols"] == len(window["data"])
    assert window["duration"] == spec["duration"]


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


def test_edit_bounce_combines_tracks(server):
    base, _ = server
    a = _upload(base, _tone_wav_bytes(seconds=1.0, freq=220.0))["file_id"]
    b = _upload(base, _tone_wav_bytes(seconds=1.0, freq=440.0))["file_id"]
    res = _post(
        base + "/api/edit",
        json.dumps(
            {
                "op": "bounce",
                "tracks": [
                    {"file_id": a, "gain": 1.0, "pan": -0.5, "offset": 0.0},
                    {"file_id": b, "gain": 0.8, "pan": 0.5, "offset": 0.25},
                ],
            }
        ).encode(),
        {"Content-Type": "application/json"},
    )
    assert res["op"] == "bounce"
    assert res["file_id"] not in (a, b)
    assert res["duration"] >= 1.2
    code, body = _get(base + res["audio_url"])
    assert code == 200 and body[:4] == b"RIFF"


def test_edit_split_returns_left_and_right(server):
    base, _ = server
    fid = _upload(base, _tone_wav_bytes(seconds=2.0))["file_id"]
    res = _post(
        base + "/api/edit",
        json.dumps({"file_id": fid, "op": "split", "at": 0.8}).encode(),
        {"Content-Type": "application/json"},
    )
    assert res["op"] == "split"
    assert "left" in res and "right" in res
    assert abs(res["left"]["duration"] - 0.8) < 0.05
    assert abs(res["right"]["duration"] - 1.2) < 0.05


def test_prefs_get_update_and_flush(server):
    base, state = server
    prefs = json.loads(_get(base + "/api/prefs")[1])
    assert prefs["cache_budget_gb"] == 20.0
    assert prefs["warm_pool_ttl_s"] == 300.0
    assert "resident_models" in prefs

    updated = _post(
        base + "/api/prefs",
        json.dumps({"cache_budget_gb": 8, "warm_pool_ttl_s": 60}).encode(),
        {"Content-Type": "application/json"},
    )
    assert updated["cache_budget_gb"] == 8.0
    assert updated["warm_pool_ttl_s"] == 60.0
    assert state.cache.disk_budget_bytes == 8_000_000_000
    assert state.vram.warm_pool_ttl_s == 60.0

    # Seed a fake resident so flush has something to report.
    from neiro.engine.vram import Device, Reservation

    cpu = next(d for d in state.vram.devices if d.kind == "cpu")
    state.vram._resident["test-model"] = Reservation("test-model", cpu, "fp32", 0.1, 1.0)
    state.vram._lru.append("test-model")
    state.vram._touched_at["test-model"] = 0.0
    state.vram._free[(cpu.kind, cpu.index)] -= 0.1

    flushed = _post(
        base + "/api/prefs/flush",
        json.dumps({"clear_cache": True}).encode(),
        {"Content-Type": "application/json"},
    )
    assert "test-model" in flushed["flushed_models"]
    assert flushed["cache_cleared"] is True
    assert flushed["resident_models"] == []


def test_job_progress_includes_structured_fields(server):
    base, _ = server
    fid = _upload(base)["file_id"]
    job = _post(
        base + "/api/separate",
        json.dumps({"file_id": fid, "preset": "vocals"}).encode(),
        {"Content-Type": "application/json"},
    )
    # First poll should expose the structured progress contract even while running.
    status = json.loads(_get(base + "/api/job/" + job["job_id"])[1])
    assert "progress" in status
    assert "stage" in status
    assert "fraction" in status
    assert "eta_s" in status
    assert "progress_events" in status
    # Wait for completion and confirm lines remain backward-compatible strings.
    for _ in range(100):
        status = json.loads(_get(base + "/api/job/" + job["job_id"])[1])
        if status["status"] in ("done", "error"):
            break
        time.sleep(0.1)
    assert status["status"] == "done"
    assert status["progress"]
    assert all(isinstance(line, str) for line in status["progress"])
    assert isinstance(status.get("fraction"), (int, float))
    assert status["fraction"] >= 0.99  # DAG wrap finishes at 1.0
    if status.get("progress_events"):
        ev = status["progress_events"][-1]
        assert "stage" in ev and "fraction" in ev and "line" in ev
        fracs = [e["fraction"] for e in status["progress_events"] if e.get("fraction") is not None]
        assert fracs == sorted(fracs) or max(fracs) >= 0.99  # overall progress advances
