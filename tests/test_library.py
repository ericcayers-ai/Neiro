"""Library contracts: SQLite persistence, scalar notes cap, markers/clips/scenes.

C12 gate. The library is local-first: no account, cloud or share-link fields.
"""

from __future__ import annotations

import io
import json
import threading
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer

import pytest

from neiro.library.store import NOTES_LIMIT, LibraryStore
from neiro.ui.server import _make_handler, _State


def _tone_wav(seconds: float = 0.4, sr: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        total = int(seconds * sr)
        frames = bytearray()
        import math

        for n in range(total):
            value = int(8000 * math.sin(2 * math.pi * 220 * n / sr))
            frames += value.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return buf.getvalue()


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_LIBRARY_DB", str(tmp_path / "library.db"))
    return LibraryStore()


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_LIBRARY_DB", str(tmp_path / "library.db"))
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


def _request(base, path, *, method="GET", body=None, token=None):
    headers = {"X-Neiro-Token": token or ""}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def test_song_round_trip_and_notes_cap(library):
    song = library.upsert_song(title="Demo", path="/tmp/demo.wav", duration=12.5, notes="first")
    assert song["id"].startswith("song_")
    assert song["notes"] == "first"
    assert library.set_notes(song["id"], "n" * NOTES_LIMIT)["notes"] == "n" * NOTES_LIMIT
    with pytest.raises(ValueError):
        library.set_notes(song["id"], "n" * (NOTES_LIMIT + 1))
    with pytest.raises(ValueError):
        library.set_notes(song["id"], ["not", "a", "string"])  # type: ignore[arg-type]
    assert library.get_song(song["id"])["markers"] == []


def test_library_survives_reopen(library, tmp_path):
    song = library.upsert_song(title="Persist", path="/tmp/persist.wav")
    library.add_marker(song["id"], 4.2, "chorus")
    library.add_clip(song["id"], name="bar 1", start=0, end=4, loop_count=2)
    del library
    reopened = LibraryStore()
    loaded = reopened.get_song(song["id"])
    assert loaded is not None
    assert loaded["title"] == "Persist"
    assert loaded["markers"][0]["label"] == "chorus"
    assert loaded["clips"][0]["loop_count"] == 2


def test_playlists_and_versions_and_scenes(library):
    song = library.upsert_song(title="Lists", path="/tmp/lists.wav")
    playlists = library.list_playlists()
    assert any(p["is_default"] for p in playlists)
    favorites = next(p for p in playlists if p["is_default"])
    library.add_to_playlist(favorites["id"], song["id"])
    again = next(p for p in library.list_playlists() if p["id"] == favorites["id"])
    assert again["songs"][0]["id"] == song["id"]

    version = library.add_version(song["id"], label="mix v2", session_path="x.neiro.json")
    assert version["label"] == "mix v2"
    scene = library.add_scene(name="Practice", kind="clip-sequence", song_id=song["id"])
    assert scene["kind"] == "clip-sequence"
    assert library.get_song(song["id"])["versions"][0]["label"] == "mix v2"


def test_library_has_no_cloud_fields(library):
    song = library.upsert_song(title="Local", path="/tmp/local.wav")
    for forbidden in ("cloud", "account", "share_url", "subscription", "slot"):
        assert forbidden not in song


# ------------------------------------------------------------------- HTTP API


def test_api_add_song_from_upload(server):
    base, state = server
    token = _token(base)
    upload = urllib.request.Request(
        base + "/api/upload",
        data=_tone_wav(),
        headers={
            "Content-Type": "application/octet-stream",
            "X-Filename": "tone.wav",
            "X-Neiro-Token": token,
        },
        method="POST",
    )
    with urllib.request.urlopen(upload) as resp:
        file_id = json.load(resp)["file_id"]

    status, payload = _request(
        base,
        "/api/library/songs",
        method="POST",
        body={"file_id": file_id, "title": "Tone"},
        token=token,
    )
    assert status == 200
    song = payload["song"]
    assert song["title"] == "Tone"
    assert song["duration"] and song["duration"] > 0.3

    status, listing = _request(base, "/api/library/songs", token=token)
    assert status == 200
    assert [s["id"] for s in listing["songs"]] == [song["id"]]


def test_api_notes_markers_clips(server):
    base, _ = server
    token = _token(base)
    _, payload = _request(
        base, "/api/library/songs", method="POST", body={"title": "No File"}, token=token
    )
    song_id = payload["song"]["id"]

    status, saved = _request(
        base,
        f"/api/library/songs/{song_id}/notes",
        method="POST",
        body={"notes": "practice slowly"},
        token=token,
    )
    assert status == 200 and saved["notes"] == "practice slowly"

    status, too_long = _request(
        base,
        f"/api/library/songs/{song_id}/notes",
        method="POST",
        body={"notes": "x" * (NOTES_LIMIT + 1)},
        token=token,
    )
    assert status == 400

    status, marker = _request(
        base,
        f"/api/library/songs/{song_id}/markers",
        method="POST",
        body={"time": 12.5, "label": "bridge"},
        token=token,
    )
    assert status == 200
    status, listing = _request(base, f"/api/library/songs/{song_id}", token=token)
    assert listing["song"]["markers"][0]["label"] == "bridge"

    status, clip = _request(
        base,
        f"/api/library/songs/{song_id}/clips",
        method="POST",
        body={"name": "solo", "start": 1, "end": 5, "loop_count": 3},
        token=token,
    )
    assert status == 200 and clip["clip"]["loop_count"] == 3

    status, deleted = _request(
        base, f"/api/library/markers/{marker['marker']['id']}", method="DELETE", token=token
    )
    assert status == 200 and deleted["ok"] is True


def test_api_library_reset_requires_confirm_and_clears_songs(server):
    base, _ = server
    token = _token(base)
    _, payload = _request(
        base, "/api/library/songs", method="POST", body={"title": "Temp"}, token=token
    )
    assert payload["song"]["id"]
    status, _ = _request(
        base, "/api/library/reset", method="POST", body={"confirm": False}, token=token
    )
    assert status == 400
    status, payload = _request(
        base, "/api/library/reset", method="POST", body={"confirm": True}, token=token
    )
    assert status == 200 and payload["removed_songs"] == 1
    _, listing = _request(base, "/api/library/songs", token=token)
    assert listing["songs"] == []


def test_api_marks_song_played(server):
    base, _ = server
    token = _token(base)
    _, payload = _request(
        base, "/api/library/songs", method="POST", body={"title": "Played"}, token=token
    )
    song_id = payload["song"]["id"]
    status, _ = _request(
        base, f"/api/library/songs/{song_id}/played", method="POST", body={}, token=token
    )
    assert status == 200
    _, detail = _request(base, f"/api/library/songs/{song_id}", token=token)
    assert detail["song"]["last_played"]


def test_api_library_requires_token(server):
    base, _ = server
    code, body = _request(base, "/api/library/songs", method="POST", body={"title": "x"})
    assert code == 401


def test_api_export_is_local_json(server):
    base, _ = server
    token = _token(base)
    status, payload = _request(base, "/api/library/export", token=token)
    assert status == 200
    assert payload["version"] == 1
    assert isinstance(payload["songs"], list)
