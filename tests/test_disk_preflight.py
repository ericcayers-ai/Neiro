"""Disk preflight: the cache preference can never fill the volume."""

from __future__ import annotations

from collections import namedtuple

import pytest

from neiro.ui import server as server_mod
from neiro.ui.server import _State

_Usage = namedtuple("_Usage", "total used free")


def test_low_disk_caps_the_effective_cache_budget(monkeypatch, tmp_path):
    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 8, 2_000_000_000))
    state = _State()
    snapshot = state.prefs_snapshot()
    assert snapshot["disk_free_gb"] == 2.0
    assert snapshot["disk_tight"] is True
    assert snapshot["cache_budget_gb"] == 20.0
    assert snapshot["cache_budget_effective_gb"] <= 1.0
    assert state.cache.disk_budget_bytes <= 1_000_000_000


def test_update_prefs_rejects_a_budget_larger_than_free_space(monkeypatch):
    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 8, 2_000_000_000))
    state = _State()
    with pytest.raises(ValueError, match="free disk"):
        state.update_prefs({"cache_budget_gb": 10})
    with pytest.raises(ValueError, match="at least"):
        state.update_prefs({"cache_budget_gb": 0.01})
    updated = state.update_prefs({"cache_budget_gb": 0.5})
    assert updated["cache_budget_gb"] == 0.5
    assert updated["cache_budget_effective_gb"] <= 0.5


def test_prefs_update_over_http_is_400(monkeypatch):
    import json
    import threading
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer

    from neiro.ui.server import _make_handler

    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 8, 2_000_000_000))
    state = _State()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(state))
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{port}"
        with urllib.request.urlopen(base + "/api/auth/token") as resp:
            token = json.load(resp)["token"]
        req = urllib.request.Request(
            base + "/api/prefs",
            data=json.dumps({"cache_budget_gb": 50}).encode(),
            headers={"Content-Type": "application/json", "X-Neiro-Token": token},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req)
        assert exc.value.code == 400
    finally:
        srv.shutdown()
        srv.server_close()
