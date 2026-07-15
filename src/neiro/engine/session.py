"""Portable Neiro session format (roadmap §2 / phase 8).

Sessions pin source fingerprints, graph configuration, model IDs + weight hashes,
licenses, artifact references, edits, and resumable job checkpoints.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SESSION_VERSION = 1


def default_home() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "Neiro"
    return Path.home() / ".neiro"


def file_fingerprint(path: Path) -> dict[str, Any]:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    st = path.stat()
    return {
        "path": str(path.resolve()),
        "sha256": h.hexdigest(),
        "size": st.st_size,
        "mtime_ns": st.st_mtime_ns,
    }


@dataclass
class ModelPin:
    model_id: str
    weight_sha256: str | None = None
    license_spdx: str | None = None


@dataclass
class JobCheckpoint:
    job_id: str
    kind: str
    completed_nodes: list[str] = field(default_factory=list)
    completed_chunks: list[str] = field(default_factory=list)
    status: str = "running"


@dataclass
class SessionDocument:
    session_version: int = SESSION_VERSION
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    name: str = "untitled"
    source: dict[str, Any] | None = None
    graph_config: dict[str, Any] = field(default_factory=dict)
    models: list[ModelPin] = field(default_factory=list)
    artifacts: dict[str, str] = field(default_factory=dict)
    edits: list[dict[str, Any]] = field(default_factory=list)
    checkpoints: list[JobCheckpoint] = field(default_factory=list)
    analysis_corrections: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SessionDocument:
        models = [ModelPin(**m) if isinstance(m, dict) else m for m in data.get("models", [])]
        checkpoints = [
            JobCheckpoint(**c) if isinstance(c, dict) else c for c in data.get("checkpoints", [])
        ]
        return cls(
            session_version=int(data.get("session_version", SESSION_VERSION)),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            name=str(data.get("name", "untitled")),
            source=data.get("source"),
            graph_config=dict(data.get("graph_config") or {}),
            models=models,
            artifacts=dict(data.get("artifacts") or {}),
            edits=list(data.get("edits") or []),
            checkpoints=checkpoints,
            analysis_corrections=dict(data.get("analysis_corrections") or {}),
            notes=list(data.get("notes") or []),
        )


class SessionStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else default_home() / "sessions"
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, name: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "session"
        return self.root / f"{safe}.neiro.json"

    def save(self, doc: SessionDocument, name: str | None = None) -> Path:
        doc.updated_at = time.time()
        if name:
            doc.name = name
        path = self.path_for(doc.name)
        path.write_text(json.dumps(doc.to_dict(), indent=2), encoding="utf-8")
        return path

    def load(self, name_or_path: str | Path) -> SessionDocument:
        path = Path(name_or_path)
        if not path.is_file():
            path = self.path_for(str(name_or_path))
        data = json.loads(path.read_text(encoding="utf-8"))
        doc = SessionDocument.from_dict(data)
        if doc.session_version > SESSION_VERSION:
            raise ValueError(
                f"session version {doc.session_version} is newer than this Neiro "
                f"({SESSION_VERSION}); upgrade the app to open it"
            )
        # Migration hook for older versions
        if doc.session_version < SESSION_VERSION:
            doc.notes.append(f"migrated from session_version {doc.session_version}")
            doc.session_version = SESSION_VERSION
        return doc

    def list_sessions(self) -> list[Path]:
        return sorted(self.root.glob("*.neiro.json"))
