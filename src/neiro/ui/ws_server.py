"""WebSocket JSON-RPC control channel (roadmap §9 UI, §11 control plane).

The HTTP server in :mod:`neiro.ui.server` is polling-based: a client starts a
job with a ``POST``, then repeatedly ``GET``s ``/api/job/<id>`` for progress.
That's simple and already fully functional — nothing here changes it or is
required for it to work. What HTTP polling can't do cheaply is push: a client
wanting live per-chunk progress has to poll fast enough to feel responsive,
wasting requests when a job is slow and lagging when it's fast.

This module adds a `JSON-RPC 2.0 <https://www.jsonrpc.org/specification>`_
protocol — pure encode/decode functions plus a small synchronous
:class:`Dispatcher` — and, when the optional ``websockets`` package is
installed, a real server that speaks it over a WebSocket so job_progress can
be *pushed* instead of polled. Everything in this module is additive: the
protocol and dispatcher are plain Python (importable and fully testable with
no network, no asyncio, no optional dependency), and the network server is
one function that degrades to a clear ``RuntimeError`` pointing back at the
REST API when ``websockets`` isn't installed. Nothing in :mod:`neiro.ui.server`
is touched, so the HTTP path is unaffected either way.

Methods exposed by :func:`build_dispatcher`:

* ``health`` — liveness + version, mirrors ``GET /api/health``.
* ``start_job`` — ``{file_id, kind, ...}`` -> ``{job_id}``, mirrors
  ``POST /api/<kind>``.
* ``cancel`` — ``{job_id}`` -> ``{job_id, status}``, mirrors
  ``POST /api/job/<id>/cancel``.
* ``job_status`` — ``{job_id}`` -> the same payload as ``GET /api/job/<id>``.

and the notification pushed to subscribers as work progresses:

* ``job_progress`` — ``{job_id, line}`` sent once per progress callback.
"""

from __future__ import annotations

import contextlib
import json
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "JSONRPC_VERSION",
    "RpcError",
    "PARSE_ERROR",
    "INVALID_REQUEST",
    "METHOD_NOT_FOUND",
    "INVALID_PARAMS",
    "INTERNAL_ERROR",
    "encode_request",
    "encode_notification",
    "encode_response",
    "encode_error",
    "decode_message",
    "Dispatcher",
    "ProgressHub",
    "build_dispatcher",
    "websockets_available",
    "serve_ws",
]

JSONRPC_VERSION = "2.0"

# Standard JSON-RPC 2.0 error codes (application errors get 1xxx, defined below).
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class RpcError(Exception):
    """A JSON-RPC error with a code, carried through the dispatcher as-is."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def encode_request(method: str, params: dict[str, Any] | None = None, *, id: Any = None) -> str:
    """Encode a JSON-RPC request. ``id`` defaults to a fresh uuid if omitted."""
    msg: dict[str, Any] = {
        "jsonrpc": JSONRPC_VERSION,
        "method": method,
        "id": id if id is not None else uuid.uuid4().hex[:12],
    }
    if params is not None:
        msg["params"] = params
    return json.dumps(msg)


def encode_notification(method: str, params: dict[str, Any] | None = None) -> str:
    """Encode a JSON-RPC notification — no ``id``, so no response is expected."""
    msg: dict[str, Any] = {"jsonrpc": JSONRPC_VERSION, "method": method}
    if params is not None:
        msg["params"] = params
    return json.dumps(msg)


def encode_response(result: Any, *, id: Any) -> str:
    return json.dumps({"jsonrpc": JSONRPC_VERSION, "result": result, "id": id})


def encode_error(code: int, message: str, *, id: Any, data: Any = None) -> str:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return json.dumps({"jsonrpc": JSONRPC_VERSION, "error": error, "id": id})


def decode_message(raw: str | bytes) -> dict[str, Any]:
    """Parse and structurally validate a JSON-RPC message.

    Raises :class:`RpcError` (``PARSE_ERROR`` / ``INVALID_REQUEST``) rather
    than a bare ``json.JSONDecodeError`` so callers can encode a compliant
    error response directly from the exception.
    """
    try:
        msg = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RpcError(PARSE_ERROR, f"invalid JSON: {exc}") from exc
    if not isinstance(msg, dict):
        raise RpcError(INVALID_REQUEST, "message must be a JSON object")
    if msg.get("jsonrpc") != JSONRPC_VERSION:
        raise RpcError(INVALID_REQUEST, f"jsonrpc must be {JSONRPC_VERSION!r}")
    if "method" not in msg or not isinstance(msg["method"], str):
        raise RpcError(INVALID_REQUEST, "method must be a string")
    if "params" in msg and not isinstance(msg["params"], dict):
        raise RpcError(INVALID_REQUEST, "params must be an object")
    return msg


class Dispatcher:
    """Synchronous JSON-RPC method registry + request handler.

    Deliberately synchronous and network-agnostic: :meth:`handle` takes and
    returns plain strings, so it can be unit tested without a socket, and
    reused verbatim by any transport (a real WS server, an in-process test
    harness, even stdio).
    """

    def __init__(self) -> None:
        self._methods: dict[str, Callable[[dict[str, Any]], Any]] = {}

    def register(self, name: str, fn: Callable[[dict[str, Any]], Any]) -> None:
        self._methods[name] = fn

    def method(self, name: str) -> Callable:
        def _decorator(fn: Callable[[dict[str, Any]], Any]) -> Callable:
            self.register(name, fn)
            return fn

        return _decorator

    def handle(self, raw: str | bytes) -> str | None:
        """Handle one incoming message, returning the JSON response string.

        Returns ``None`` for a well-formed notification (no ``id``) — per the
        spec, notifications get no response, matching how ``job_progress``
        pushes are sent without expecting an ack.
        """
        try:
            msg = decode_message(raw)
        except RpcError as exc:
            # Nothing usable to correlate a parse failure with, per spec id=null.
            return encode_error(exc.code, exc.message, id=None, data=exc.data)

        msg_id = msg.get("id")
        method = msg["method"]
        params = msg.get("params") or {}
        handler = self._methods.get(method)
        if handler is None:
            if msg_id is None:
                return None
            return encode_error(METHOD_NOT_FOUND, f"unknown method {method!r}", id=msg_id)
        try:
            result = handler(params)
        except RpcError as exc:
            if msg_id is None:
                return None
            return encode_error(exc.code, exc.message, id=msg_id, data=exc.data)
        except Exception as exc:  # surface as a JSON-RPC error, never crash the loop
            if msg_id is None:
                return None
            return encode_error(INTERNAL_ERROR, str(exc), id=msg_id)
        if msg_id is None:
            return None
        return encode_response(result, id=msg_id)


@dataclass
class ProgressHub:
    """Thread-safe fan-out of ``job_progress`` notifications to subscribers.

    A subscriber is any callable accepting the already-encoded notification
    string — the WS server registers one per open connection (queue a send);
    tests register one that just appends to a list.
    """

    _subscribers: list[Callable[[str], None]] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def subscribe(self, fn: Callable[[str], None]) -> Callable[[], None]:
        with self._lock:
            self._subscribers.append(fn)

        def _unsubscribe() -> None:
            with self._lock:
                if fn in self._subscribers:
                    self._subscribers.remove(fn)

        return _unsubscribe

    def publish(self, job_id: str, line: str) -> None:
        notification = encode_notification("job_progress", {"job_id": job_id, "line": line})
        with self._lock:
            subscribers = list(self._subscribers)
        for fn in subscribers:
            # A dead subscriber shouldn't break progress for the rest.
            with contextlib.suppress(Exception):
                fn(notification)


def build_dispatcher(
    *,
    start_job: Callable[[str, str, dict[str, Any]], str] | None = None,
    job_status: Callable[[str], dict[str, Any] | None] | None = None,
    cancel_job: Callable[[str], dict[str, Any]] | None = None,
) -> Dispatcher:
    """Build the standard Neiro method set as plain callables.

    Each hook mirrors one HTTP endpoint in :mod:`neiro.ui.server` (``kind``,
    ``file_id`` and the returned dicts are the same shapes as the REST JSON),
    but takes/returns plain Python rather than depending on ``_State`` or
    ``BaseHTTPRequestHandler`` — a caller (typically a thin adapter next to a
    running ``_State``) supplies them, keeping this module importable and
    testable with zero HTTP server dependency. ``health`` needs no hook: it
    never depends on job/file state, so it's always registered.
    """
    from neiro import __version__

    dispatcher = Dispatcher()

    @dispatcher.method("health")
    def _health(_params: dict[str, Any]) -> dict[str, Any]:
        return {"status": "ok", "version": __version__, "engine": "python-sidecar"}

    if start_job is not None:

        @dispatcher.method("start_job")
        def _start_job(params: dict[str, Any]) -> dict[str, Any]:
            file_id = params.get("file_id")
            kind = params.get("kind")
            if not file_id or kind not in ("separate", "transcribe", "enhance"):
                raise RpcError(
                    INVALID_PARAMS,
                    "start_job needs file_id and kind in {separate, transcribe, enhance}",
                )
            return {"job_id": start_job(kind, file_id, params)}

    if job_status is not None:

        @dispatcher.method("job_status")
        def _job_status(params: dict[str, Any]) -> dict[str, Any]:
            job_id = params.get("job_id")
            job = job_status(job_id) if job_id else None
            if job is None:
                raise RpcError(INVALID_PARAMS, f"unknown job_id {job_id!r}")
            return job

    if cancel_job is not None:

        @dispatcher.method("cancel")
        def _cancel(params: dict[str, Any]) -> dict[str, Any]:
            job_id = params.get("job_id")
            if not job_id:
                raise RpcError(INVALID_PARAMS, "cancel needs job_id")
            return cancel_job(job_id)

    return dispatcher


def websockets_available() -> bool:
    try:
        import websockets  # noqa: F401
    except ImportError:
        return False
    return True


async def serve_ws(host: str, port: int, dispatcher: Dispatcher, hub: ProgressHub) -> None:
    """Run the JSON-RPC WebSocket server until cancelled.

    Requires the optional ``websockets`` package (``pip install neiro[ws]``);
    raises :class:`RuntimeError` with a pointer back to the REST API otherwise
    rather than failing in some more confusing way deeper in the import.
    Every open connection is subscribed to ``hub`` for the duration of the
    connection and unsubscribed on close/error, so a slow or dead client
    can't accumulate leaked subscriptions.
    """
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError(
            "neiro.ui.ws_server.serve_ws requires the optional 'websockets' "
            "package (pip install websockets). The HTTP REST API in "
            "neiro.ui.server works fully without it."
        ) from exc

    async def _handler(websocket) -> None:
        import asyncio

        loop = asyncio.get_event_loop()

        def _push(notification: str) -> None:
            asyncio.run_coroutine_threadsafe(websocket.send(notification), loop)

        unsubscribe = hub.subscribe(_push)
        try:
            async for raw in websocket:
                response = dispatcher.handle(raw)
                if response is not None:
                    await websocket.send(response)
        finally:
            unsubscribe()

    async with websockets.serve(_handler, host, port):
        import asyncio

        await asyncio.Future()  # run until externally cancelled
