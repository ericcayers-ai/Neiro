"""HTTP helpers for 1.1 roadmap MVPs: plan strip, sessions, compute, notes, Arrow bulk."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

__all__ = [
    "serialize_plan",
    "plan_payload",
    "flush_vram",
    "vram_status",
    "save_session_doc",
    "list_sessions",
    "open_session_doc",
    "notes_to_public",
    "arrow_table_bytes",
]


def serialize_plan(plan: Any) -> dict[str, Any]:
    """Serialize a planner plan's DAG into a UI-friendly node strip."""
    graph = getattr(plan, "graph", None)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, str]] = []
    if graph is not None:
        node_map = getattr(graph, "_nodes", None) or getattr(graph, "nodes", {}) or {}
        if not isinstance(node_map, dict):
            node_map = {}
        for n in node_map.values():
            nid = getattr(n, "node_id", str(n))
            cfg = n.config_repr() if hasattr(n, "config_repr") else type(n).__name__
            nodes.append({"id": nid, "type": type(n).__name__, "config": cfg})
            for port, (up_id, up_port) in getattr(n, "inputs", {}).items():
                edges.append(
                    {
                        "from": up_id,
                        "from_port": up_port,
                        "to": nid,
                        "to_port": port,
                    }
                )
    kind = type(plan).__name__.replace("Plan", "").lower()
    return {
        "kind": kind,
        "model_id": getattr(plan, "model_id", None),
        "notes": list(getattr(plan, "notes", []) or []),
        "quality": getattr(plan, "quality", None),
        "nodes": nodes,
        "edges": edges,
        "stem_ports": list(getattr(plan, "stem_ports", []) or []),
        "chain": list(getattr(plan, "chain", []) or []),
        "compile_node": getattr(plan, "compile_node", None),
        "separate_node": getattr(plan, "separate_node", None),
        "output_node": getattr(plan, "output_node", None),
    }


def plan_payload(
    *,
    kind: str,
    file_path: Path,
    registry,
    vram,
    preset: str = "vocals",
    mode: str = "auto",
    model: str | None = None,
    members: list[str] | None = None,
    chain: list[str] | None = None,
    quality: str | None = None,
    bleed_suppress: bool = True,
    corrections: Any = None,
) -> dict[str, Any]:
    from neiro.engine.planner import plan_enhancement, plan_separation, plan_transcription

    if kind == "separate":
        plan = plan_separation(
            file_path,
            preset,
            registry,
            vram,
            quality=quality,
            bleed_suppress=bleed_suppress,
            auto_download=False,
            corrections=corrections,
        )
    elif kind == "transcribe":
        plan = plan_transcription(
            file_path,
            registry,
            vram,
            mode=mode,
            model=model,
            members=members,
            auto_download=False,
            corrections=corrections,
        )
    elif kind == "enhance":
        plan = plan_enhancement(
            file_path,
            registry,
            vram,
            chain=chain,
            auto_download=False,
            corrections=corrections,
        )
    else:
        raise ValueError(f"unknown plan kind {kind!r}")
    return serialize_plan(plan)


def flush_vram(vram) -> dict[str, Any]:
    before = list(vram.resident_models())
    for mid in list(before):
        vram.release(mid)
    return {"ok": True, "flushed": before, "resident": vram.resident_models()}


def vram_status(vram) -> dict[str, Any]:
    devices = [
        {
            "name": d.name,
            "kind": d.kind,
            "index": d.index,
            "total_gb": d.total_gb,
            "free_gb": vram.free_gb(d),
        }
        for d in vram.devices
    ]
    return {
        "resident": vram.resident_models(),
        "has_accelerator": vram.has_accelerator,
        "devices": devices,
    }


def save_session_doc(
    *,
    name: str,
    file_id: str | None,
    file_path: Path | None,
    graph_config: dict[str, Any],
    notes: list[str] | None = None,
) -> dict[str, Any]:
    from neiro.engine.session import SessionDocument, SessionStore, file_fingerprint

    store = SessionStore()
    doc = SessionDocument(name=name or "untitled", graph_config=dict(graph_config or {}))
    if file_path is not None and Path(file_path).is_file():
        doc.source = file_fingerprint(Path(file_path))
        doc.artifacts["source_file_id"] = file_id or ""
    if notes:
        doc.notes = list(notes)
    path = store.save(doc, name=name)
    return {"ok": True, "name": doc.name, "path": str(path), "session": doc.to_dict()}


def list_sessions() -> dict[str, Any]:
    from neiro.engine.session import SessionStore

    store = SessionStore()
    names = []
    for path in store.list_sessions():
        names.append({"name": path.stem.replace(".neiro", ""), "path": str(path)})
    return {"sessions": names}


def open_session_doc(name: str) -> dict[str, Any]:
    from neiro.engine.session import SessionStore

    store = SessionStore()
    doc = store.load(name)
    return {"ok": True, "session": doc.to_dict()}


def notes_to_public(session) -> dict[str, Any]:
    tracks = {
        name: [
            {
                "onset": e.onset,
                "offset": e.offset,
                "pitch": e.pitch,
                "velocity": e.velocity,
                "confidence": e.confidence,
                "user_verified": e.user_verified,
            }
            for e in session.list_notes(name)
        ]
        for name in session.track_names()
    }
    return {
        "tempo_bpm": session.tempo_bpm,
        "tracks": tracks,
        "summary": session.confidence_summary(),
    }


def arrow_table_bytes(columns: dict[str, list]) -> bytes | None:
    """Encode a simple column dict as Arrow IPC stream bytes, or None if pyarrow missing."""
    try:
        import pyarrow as pa
        import pyarrow.ipc as ipc
    except Exception:
        return None
    arrays = {k: pa.array(v) for k, v in columns.items()}
    table = pa.table(arrays)
    sink = io.BytesIO()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()


def dumps_plan_safe(payload: dict[str, Any]) -> str:
    return json.dumps(payload)
