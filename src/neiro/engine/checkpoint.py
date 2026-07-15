"""Job checkpoints & crash resume (roadmap §2.2 scheduler, §11 crash resume).

A :class:`~neiro.engine.graph.Graph` already memoises per-node results in the
:class:`~neiro.engine.cache.ArtifactCache`; if that cache is disk-backed, a new
process picking up the same ``disk_dir`` gets node-level resume for free — a
completed node's result is a cache hit, not a recompute.

That's not enough for a single long-running node processing a file in chunks
(a Separate node chewing through a two-hour recording): losing power nine
chunks into ten shouldn't mean starting chunk one over. :class:`JobCheckpoint`
is a small durable journal — completed node cache keys, completed chunk
hashes, per job id — and :class:`ChunkedJobRunner` drives a chunk loop against
it plus the artifact cache, so a resumed run only pays for the chunks that
weren't finished.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from neiro.engine.cache import ArtifactCache, cache_key

__all__ = [
    "JobCheckpoint",
    "CheckpointStore",
    "ChunkedJobRunner",
    "CheckpointedCancelledError",
    "default_checkpoint_home",
]


def default_checkpoint_home() -> Path:
    from neiro.engine.session import default_home

    return default_home() / "checkpoints"


class CheckpointedCancelledError(RuntimeError):
    """Raised by :class:`ChunkedJobRunner` when cancellation is observed mid-job.

    The checkpoint is saved *before* this is raised, so the next
    :meth:`ChunkedJobRunner.run` against the same job id resumes rather than
    restarts.
    """


@dataclass
class JobCheckpoint:
    """Durable record of a job's progress, independent of the in-memory cache.

    ``completed_nodes`` maps a whole node's id to the cache key it produced —
    useful for skipping a node entirely without even touching the cache.
    ``completed_chunks`` maps a node id to the set of chunk hashes it has
    finished — the chunk-granular resume primitive (roadmap R-0115).
    """

    job_id: str
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    completed_nodes: dict[str, str] = field(default_factory=dict)
    completed_chunks: dict[str, list[str]] = field(default_factory=dict)
    cancelled: bool = False

    def node_done(self, node_id: str, current_cache_key: str) -> bool:
        return self.completed_nodes.get(node_id) == current_cache_key

    def mark_node_done(self, node_id: str, cache_key_: str) -> None:
        self.completed_nodes[node_id] = cache_key_
        self.updated_at = time.time()

    def chunk_hashes(self, node_id: str) -> set[str]:
        return set(self.completed_chunks.get(node_id, []))

    def chunk_done(self, node_id: str, chunk_hash: str) -> bool:
        return chunk_hash in self.chunk_hashes(node_id)

    def mark_chunk_done(self, node_id: str, chunk_hash: str) -> None:
        lst = self.completed_chunks.setdefault(node_id, [])
        if chunk_hash not in lst:
            lst.append(chunk_hash)
        self.updated_at = time.time()

    def progress(self, node_id: str, total_chunks: int) -> float:
        if total_chunks <= 0:
            return 0.0
        return min(1.0, len(self.chunk_hashes(node_id)) / total_chunks)

    def as_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_nodes": self.completed_nodes,
            "completed_chunks": self.completed_chunks,
            "cancelled": self.cancelled,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> JobCheckpoint:
        return cls(
            job_id=d["job_id"],
            created_at=float(d.get("created_at", time.time())),
            updated_at=float(d.get("updated_at", time.time())),
            completed_nodes=dict(d.get("completed_nodes", {})),
            completed_chunks={k: list(v) for k, v in d.get("completed_chunks", {}).items()},
            cancelled=bool(d.get("cancelled", False)),
        )


class CheckpointStore:
    """Persists :class:`JobCheckpoint` journals as JSON under a home directory."""

    def __init__(self, home: str | Path | None = None) -> None:
        self.home = Path(home) if home is not None else default_checkpoint_home()

    def _path(self, job_id: str) -> Path:
        safe = "".join(c for c in job_id if c.isalnum() or c in "-_") or "job"
        return self.home / f"{safe}.checkpoint.json"

    def load(self, job_id: str) -> JobCheckpoint:
        path = self._path(job_id)
        if path.is_file():
            try:
                return JobCheckpoint.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except Exception:
                pass
        return JobCheckpoint(job_id=job_id)

    def save(self, checkpoint: JobCheckpoint) -> Path:
        checkpoint.updated_at = time.time()
        path = self._path(checkpoint.job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(checkpoint.as_dict(), indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(path)
        return path

    def delete(self, job_id: str) -> None:
        self._path(job_id).unlink(missing_ok=True)

    def exists(self, job_id: str) -> bool:
        return self._path(job_id).is_file()


class ChunkedJobRunner:
    """Runs a chunked node computation with crash-resume checkpointing.

    Each chunk's result is memoised in ``cache`` under a key derived from
    ``node_id``, ``config_repr``, and the chunk's own content key — the usual
    content-addressed cache contract. The checkpoint journal separately (and
    durably) records which chunk keys are known-good, so a fresh process
    resuming the same job id can tell instantly which chunks are already done
    without depending on the in-memory cache still being warm — only the
    disk-backed cache and the checkpoint file, both of which survive a crash.

    Cancellation is checked *before* each chunk (matching the graph runtime's
    cooperative-cancel contract in roadmap R-0023): a cancelled run keeps every
    chunk it already finished, in both the cache and the checkpoint.
    """

    def __init__(
        self,
        node_id: str,
        config_repr: str,
        cache: ArtifactCache,
        checkpoint: JobCheckpoint,
        store: CheckpointStore,
    ) -> None:
        self.node_id = node_id
        self.config_repr = config_repr
        self.cache = cache
        self.checkpoint = checkpoint
        self.store = store

    def run(
        self,
        chunks: list[Any],
        chunk_content_key: Callable[[Any], str],
        compute_chunk: Callable[[Any], Any],
        *,
        cancelled: Callable[[], bool] | None = None,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> list[Any]:
        results: list[Any] = []
        total = len(chunks)
        for i, chunk in enumerate(chunks):
            if cancelled is not None and cancelled():
                self.store.save(self.checkpoint)
                raise CheckpointedCancelledError(
                    f"cancelled before chunk {i}/{total} of node {self.node_id!r} "
                    f"({len(results)} chunk(s) already checkpointed)"
                )
            content_key = chunk_content_key(chunk)
            key = cache_key(self.node_id, self.config_repr, [content_key])

            def _compute(chunk=chunk) -> Any:
                return compute_chunk(chunk)

            result = self.cache.get_or_compute(key, _compute, provenance=(self.node_id, "chunk"))
            self.checkpoint.mark_chunk_done(self.node_id, content_key)
            self.store.save(self.checkpoint)
            results.append(result)
            if on_progress is not None:
                on_progress(i + 1, total)
        self.checkpoint.mark_node_done(self.node_id, cache_key(self.node_id, self.config_repr, []))
        self.store.save(self.checkpoint)
        return results
