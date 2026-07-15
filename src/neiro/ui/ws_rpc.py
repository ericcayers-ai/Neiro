"""WebSocket JSON-RPC control plane helpers (roadmap §2.1).

The HTTP API remains the primary transport for CLI/browser fallback. This module
defines the JSON-RPC envelope and a thread-safe in-process event bus the UI can
subscribe to. A full `websockets` server is started when the optional dependency
is installed; otherwise callers stay on REST polling.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

__all__ = ["RpcRequest", "RpcResponse", "EventBus", "handle_rpc", "try_serve_ws"]


@dataclass
class RpcRequest:
    method: str
    params: dict[str, Any] = field(default_factory=dict)
    id: str | int | None = None

    @classmethod
    def from_json(cls, raw: str | bytes) -> RpcRequest:
        data = json.loads(raw)
        return cls(
            method=str(data.get("method", "")),
            params=dict(data.get("params") or {}),
            id=data.get("id"),
        )


@dataclass
class RpcResponse:
    id: str | int | None
    result: Any = None
    error: dict[str, Any] | None = None

    def to_json(self) -> str:
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": self.id}
        if self.error is not None:
            body["error"] = self.error
        else:
            body["result"] = self.result
        return json.dumps(body)


class EventBus:
    def __init__(self) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._lock = threading.Lock()

    def subscribe(self, cb: Callable[[dict[str, Any]], None]) -> None:
        with self._lock:
            self._subs.append(cb)

    def publish(self, event: str, payload: dict[str, Any]) -> None:
        msg = {"event": event, **payload}
        with self._lock:
            subs = list(self._subs)
        for cb in subs:
            try:
                cb(msg)
            except Exception:
                pass


def handle_rpc(
    req: RpcRequest,
    *,
    health: Callable[[], dict[str, Any]],
    cancel: Callable[[str], dict[str, Any]] | None = None,
) -> RpcResponse:
    if req.method == "health":
        return RpcResponse(id=req.id, result=health())
    if req.method == "cancel" and cancel is not None:
        job_id = str(req.params.get("job_id", ""))
        return RpcResponse(id=req.id, result=cancel(job_id))
    return RpcResponse(
        id=req.id,
        error={"code": -32601, "message": f"method not found: {req.method}"},
    )


def try_serve_ws(host: str = "127.0.0.1", port: int = 8378) -> str | None:
    """Start a WebSocket server if ``websockets`` is installed. Returns URL or None."""
    try:
        import asyncio

        import websockets  # type: ignore
    except Exception:
        return None

    from neiro import __version__

    bus = EventBus()

    async def _handler(websocket):
        async for message in websocket:
            req = RpcRequest.from_json(message)
            resp = handle_rpc(
                req,
                health=lambda: {"status": "ok", "version": __version__, "transport": "ws"},
            )
            await websocket.send(resp.to_json())

    def _run():
        asyncio.run(websockets.serve(_handler, host, port))

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return f"ws://{host}:{port}"
