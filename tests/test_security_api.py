"""Security contract for the local API: token, Origin, Content-Type, caps, consent.

These are the C8/C9 gate tests. They drive the real handler in-process so routing,
headers and body limits are exercised, not mocked.
"""

from __future__ import annotations

import http.client
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from neiro.ui.server import _make_handler, _State


@pytest.fixture
def server():
    state = _State()
    state.security.max_json_bytes = 1024
    state.security.max_upload_bytes = 64
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


def _request(base, path, *, method="GET", data=None, headers=None):
    req = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def test_mutation_requires_token(server):
    base, _ = server
    code, _, body = _request(
        base,
        "/api/prefs",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    assert code == 401
    assert b"X-Neiro-Token" in body


def test_mutation_accepts_token(server):
    base, state = server
    code, _, body = _request(
        base,
        "/api/prefs",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 200
    assert json.loads(body)["cache_budget_gb"] >= 0


def test_cross_origin_rejected_even_with_token(server):
    base, state = server
    code, _, _ = _request(
        base,
        "/api/prefs",
        method="POST",
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "X-Neiro-Token": state.security.token,
            "Origin": "https://evil.example",
        },
    )
    assert code == 403


def test_text_plain_json_is_415(server):
    base, state = server
    code, _, _ = _request(
        base,
        "/api/prefs",
        method="POST",
        data=b'{"cache_budget_gb": 2}',
        headers={"Content-Type": "text/plain", "X-Neiro-Token": state.security.token},
    )
    assert code == 415


def test_oversized_json_body_is_413(server):
    base, state = server
    payload = json.dumps({"cache_budget_gb": 1, "pad": "x" * 4000}).encode()
    code, _, _ = _request(
        base,
        "/api/prefs",
        method="POST",
        data=payload,
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 413


def test_upload_over_cap_is_413(server):
    base, state = server
    code, _, _ = _request(
        base,
        "/api/upload",
        method="POST",
        data=b"RIFF" + b"\x00" * 200,
        headers={"Content-Type": "application/octet-stream", "X-Neiro-Token": state.security.token},
    )
    assert code == 413


def test_upload_as_json_is_415(server):
    base, state = server
    code, _, _ = _request(
        base,
        "/api/upload",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 415


def test_plugin_grant_requires_confirm(server):
    base, state = server
    code, _, body = _request(
        base,
        "/api/plugins",
        method="POST",
        data=json.dumps({"grants": {"demo": True}}).encode(),
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 400
    assert b"confirm" in body


def test_tool_install_requires_confirm(server):
    base, state = server
    code, _, body = _request(
        base,
        "/api/tools/install",
        method="POST",
        data=json.dumps({"tool": "verovio"}).encode(),
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 400
    assert b"confirm" in body


def test_token_endpoint_refuses_cross_site_fetch(server):
    base, _ = server
    code, _, _ = _request(
        base,
        "/api/auth/token",
        headers={"Sec-Fetch-Site": "cross-site"},
    )
    assert code == 403


def test_token_endpoint_serves_local_ui(server):
    base, state = server
    code, _, body = _request(base, "/api/auth/token")
    assert code == 200
    assert json.loads(body)["token"] == state.security.token


def test_options_reflects_allowlisted_origin(server):
    base, _ = server
    origin = "http://127.0.0.1:5173"
    code, headers, _ = _request(base, "/api/prefs", method="OPTIONS", headers={"Origin": origin})
    assert code == 204
    assert headers.get("Access-Control-Allow-Origin") == origin


def test_options_denies_unknown_origin(server):
    base, _ = server
    code, headers, _ = _request(
        base, "/api/prefs", method="OPTIONS", headers={"Origin": "https://evil.example"}
    )
    assert code == 403
    assert "Access-Control-Allow-Origin" not in headers


def test_no_wildcard_cors(server):
    base, _ = server
    code, headers, _ = _request(base, "/api/health", headers={"Origin": "https://evil.example"})
    assert code == 403
    assert headers.get("Access-Control-Allow-Origin") is None


def test_non_loopback_host_rejected(server):
    base, _ = server
    port = base.rsplit(":", 1)[1]
    conn = http.client.HTTPConnection("127.0.0.1", int(port), timeout=10)
    conn.putrequest("GET", "/api/health", skip_host=True)
    conn.putheader("Host", "evil.example")
    conn.endheaders()
    resp = conn.getresponse()
    assert resp.status == 403
    resp.read()
    conn.close()


def test_daw_bridge_is_not_token_gated(server):
    """The native VST/CLAP bridge cannot fetch a browser token; its routes rely on
    loopback Host + non-simple content types instead of 401."""
    base, _ = server
    code, _, _ = _request(
        base,
        "/api/daw/heartbeat",
        method="POST",
        data=json.dumps({"instance_id": "nope"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert code == 404


def test_ingest_url_blocks_loopback_target(server):
    base, state = server
    code, _, body = _request(
        base,
        "/api/ingest-url",
        method="POST",
        data=json.dumps({"url": "http://127.0.0.1:8080/secret"}).encode(),
        headers={"Content-Type": "application/json", "X-Neiro-Token": state.security.token},
    )
    assert code == 400
    assert b"private" in body or b"not allowed" in body


def test_path_traversal_still_blocked(server):
    base, _ = server
    code, _, _ = _request(base, "/files/../../../../Windows/win.ini")
    assert code == 404


def test_pairing_code_is_local_only(server):
    base, _ = server
    code, _, body = _request(base, "/api/pair/code")
    assert code == 200
    assert json.loads(body)["code"].isdigit()
    assert len(json.loads(body)["code"]) == 6
    code, _, _ = _request(base, "/api/pair/code", headers={"Sec-Fetch-Site": "cross-site"})
    assert code == 403


def test_pairing_exchanges_the_code_without_a_token_and_rotates_it(server):
    base, state = server
    code, _, body = _request(base, "/api/pair/code")
    assert code == 200
    pairing_code = json.loads(body)["code"]

    wrong, _, _ = _request(
        base,
        "/api/pair",
        method="POST",
        data=b'{"code": "000000"}',
        headers={"Content-Type": "application/json", "Origin": "chrome-extension://abc"},
    )
    assert wrong == 403

    ok, _, body = _request(
        base,
        "/api/pair",
        method="POST",
        data=json.dumps({"code": pairing_code}).encode(),
        headers={"Content-Type": "application/json", "Origin": "chrome-extension://abc"},
    )
    assert ok == 200
    assert json.loads(body)["token"] == state.security.token

    # The used code is rotated, so replay fails.
    replay, _, _ = _request(
        base,
        "/api/pair",
        method="POST",
        data=json.dumps({"code": pairing_code}).encode(),
        headers={"Content-Type": "application/json", "Origin": "chrome-extension://abc"},
    )
    assert replay == 403


def test_pairing_rejects_non_extension_origins(server):
    base, _ = server
    code, _, _ = _request(
        base,
        "/api/pair",
        method="POST",
        data=b'{"code": "123456"}',
        headers={"Content-Type": "application/json", "Origin": "https://evil.example"},
    )
    assert code == 403
