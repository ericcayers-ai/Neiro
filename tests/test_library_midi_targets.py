"""MIDI practice targets (PianoVision adoption leg F): import, describe, serve.

The contract under test:
* a user's ``.mid`` becomes a stored target whose ``tracks`` are the exact
  ``Record<string, MidiEvent[]>`` shape the practice panel already consumes;
* the file's own tempo is carried through, so bar lines are placed from the file and not
  from a hard-coded 120 BPM;
* nothing is registered when the bytes carry no notes, and the refusal names the reason;
* the bytes are reachable again at ``/api/library/midi-file/<id>``.

The practice *descriptor* (difficulty, notes/second, whether the file is too small to
practise) is deliberately NOT computed here: it has one implementation, in
``frontend/src/practice/library.ts``, and this layer stores only what the file says.
"""

from __future__ import annotations

import base64
import io
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from neiro.engine.artifacts import NoteEvent, NoteStream, Timeline
from neiro.library.store import LibraryStore
from neiro.symbolic.midi import read_midi_notes, write_midi
from neiro.ui.library_api import handle_library
from neiro.ui.server import _make_handler, _State


def _timeline(bpm: float = 90.0) -> Timeline:
    events = tuple(
        NoteEvent(onset=round(0.25 * i, 3), offset=round(0.25 * i + 0.2, 3), pitch=60 + i)
        for i in range(9)
    )
    melody = NoteStream(events, tempo_bpm=bpm, source="test")
    return Timeline(tracks=(("piano", melody),), tempo_bpm=bpm)


def _midi_bytes(bpm: float = 90.0) -> bytes:
    # write_midi takes a path; a temporary file keeps the fixture honest — it is the same
    # writer the app uses, not a second hand-rolled encoder in the test.
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        path = write_midi(_timeline(bpm), Path(tmp) / "fixture.mid")
        return path.read_bytes()


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_LIBRARY_DB", str(tmp_path / "library.db"))
    return _State()


def _post(state, payload):
    return handle_library(state, "POST", "/api/library/midi-targets", payload)


def _encoded(data: bytes, name: str = "fixture.mid") -> dict:
    return {"name": name, "midi_base64": base64.b64encode(data).decode("ascii")}


def test_read_midi_notes_reports_the_files_own_tempo(tmp_path):
    path = write_midi(_timeline(90.0), tmp_path / "tempo.mid")
    stream = read_midi_notes(path)
    assert stream.tempo_bpm == pytest.approx(90.0, abs=0.01)
    assert len(stream.events) == 9
    assert stream.source == "midi-import"


def test_import_registers_the_target_in_the_panel_shape(state):
    status, payload = _post(state, _encoded(_midi_bytes()))
    assert status == 200, payload
    target = payload["target"]
    assert target["id"].startswith("mid_")
    assert target["title"] == "fixture"
    assert target["tempo_bpm"] == pytest.approx(90.0, abs=0.01)

    tracks = target["tracks"]
    assert list(tracks) == ["piano"]
    first = tracks["piano"][0]
    # Exactly MidiEvent from frontend/src/api/types.ts — no extra or missing field, because
    # the practice panel and library.ts read these keys positionally in spirit.
    assert set(first) == {"onset", "offset", "pitch", "velocity", "confidence"}
    assert first["pitch"] == 60
    assert first["confidence"] == 1.0
    assert len(tracks["piano"]) == 9

    listed = handle_library(state, "GET", "/api/library/midi-targets")[1]["targets"]
    assert [t["id"] for t in listed] == [target["id"]]
    fetched = handle_library(state, "GET", f"/api/library/midi-targets/{target['id']}")[1]
    assert fetched["target"]["id"] == target["id"]


def test_import_rejects_a_file_with_no_notes(state):
    empty = Timeline(tracks=(("piano", NoteStream((), tempo_bpm=120.0)),), tempo_bpm=120.0)
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        data = write_midi(empty, Path(tmp) / "empty.mid").read_bytes()
    status, payload = _post(state, _encoded(data, "empty.mid"))
    assert status == 400
    assert payload["error"] == "this file carries no notes"
    # Nothing was registered, so the library cannot show a card for a file it cannot read.
    assert handle_library(state, "GET", "/api/library/midi-targets")[1]["targets"] == []


def test_import_rejects_bytes_that_are_not_midi(state):
    status, payload = _post(state, _encoded(b"not a midi file", "broken.mid"))
    assert status == 400
    assert "couldn't read the MIDI file" in payload["error"]


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({"name": "track.wav", "midi_base64": "AAAA"}, ".mid or .midi"),
        ({"name": "track.mid"}, "midi_base64 is required"),
        ({"name": "track.mid", "midi_base64": "not base64!"}, "not valid base64"),
    ],
)
def test_import_rejects_bad_requests_with_a_reason(state, body, reason):
    status, payload = _post(state, body)
    assert status == 400
    assert reason in payload["error"]


def test_store_keeps_one_row_per_file_and_can_delete_it(state):
    data = _midi_bytes()
    first = _post(state, _encoded(data))[1]["target"]
    second = _post(state, _encoded(data))[1]["target"]
    # Re-importing the same file updates the row rather than stacking duplicates.
    assert second["id"] == first["id"]
    assert len(handle_library(state, "GET", "/api/library/midi-targets")[1]["targets"]) == 1

    status, payload = handle_library(
        state, "DELETE", f"/api/library/midi-targets/{first['id']}"
    )
    assert (status, payload["ok"]) == (200, True)
    assert handle_library(state, "GET", "/api/library/midi-targets")[1]["targets"] == []


def test_store_rejects_a_target_that_is_not_a_track_map(state):
    store = LibraryStore()
    with pytest.raises(ValueError):
        store.upsert_midi_target(title="x", tracks=["not", "a", "map"])  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        store.upsert_midi_target(title="   ", tracks={})


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("NEIRO_LIBRARY_DB", str(tmp_path / "library.db"))
    state = _State()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(state))
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        srv.shutdown()
        srv.server_close()


def _token(base: str) -> str:
    with urllib.request.urlopen(base + "/api/auth/token") as resp:
        return json.load(resp)["token"]


def test_http_surface_imports_and_serves_the_midi_bytes(server):
    token = _token(server)
    data = _midi_bytes()
    body = json.dumps(_encoded(data)).encode()
    request = urllib.request.Request(
        server + "/api/library/midi-targets",
        data=body,
        headers={"Content-Type": "application/json", "X-Neiro-Token": token},
        method="POST",
    )
    with urllib.request.urlopen(request) as resp:
        assert resp.status == 200
        target = json.load(resp)["target"]

    with urllib.request.urlopen(
        server + f"/api/library/midi-file/{target['id']}"
    ) as resp:
        assert resp.status == 200
        assert resp.headers.get_content_type() == "audio/midi"
        # Byte-identical to what was imported: the download link is the user's file.
        assert resp.read() == data

    missing = urllib.request.Request(server + "/api/library/midi-file/mid_missing")
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        urllib.request.urlopen(missing)
    assert excinfo.value.code == 404
