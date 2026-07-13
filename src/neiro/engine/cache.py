"""Content-addressed artifact cache (roadmap §2.2).

Keys are derived from the hashes of a node's inputs, its configuration, and the
version of any model it uses. Re-running a job with one changed parameter
recomputes only the affected subgraph; unchanged nodes return cached results.

The M0 implementation is an in-process LRU. The key derivation is the durable
part — a disk-backed store can be dropped in behind the same interface.
"""

from __future__ import annotations

import hashlib
import pickle
from collections import OrderedDict
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

__all__ = ["ArtifactCache", "cache_key"]


def cache_key(node_id: str, config_repr: str, input_keys: list[str]) -> str:
    h = hashlib.sha256()
    h.update(node_id.encode())
    h.update(b"\x00")
    h.update(config_repr.encode())
    for k in sorted(input_keys):
        h.update(b"\x00")
        h.update(k.encode())
    return h.hexdigest()[:32]


class ArtifactCache:
    def __init__(self, max_entries: int = 256, disk_dir: str | Path | None = None) -> None:
        self._store: OrderedDict[str, Any] = OrderedDict()
        self._max = max_entries
        self.hits = 0
        self.misses = 0
        self.disk_dir = Path(disk_dir) if disk_dir else None
        if self.disk_dir is not None:
            self.disk_dir.mkdir(parents=True, exist_ok=True)

    def _disk_path(self, key: str) -> Path:
        assert self.disk_dir is not None
        return self.disk_dir / f"{key}.pkl"

    def _read_disk(self, key: str) -> Any | None:
        if self.disk_dir is None:
            return None
        path = self._disk_path(key)
        if not path.is_file():
            return None
        try:
            return pickle.loads(path.read_bytes())
        except Exception:
            path.unlink(missing_ok=True)
            return None

    def _write_disk(self, key: str, value: Any) -> None:
        if self.disk_dir is None:
            return
        with suppress(Exception):
            self._disk_path(key).write_bytes(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL))

    def get_or_compute(self, key: str, compute: Callable[[], Any]) -> Any:
        if key in self._store:
            self._store.move_to_end(key)
            self.hits += 1
            return self._store[key]
        disk_val = self._read_disk(key)
        if disk_val is not None:
            self._store[key] = disk_val
            self._store.move_to_end(key)
            self.hits += 1
            return disk_val
        self.misses += 1
        value = compute()
        self._store[key] = value
        self._store.move_to_end(key)
        self._write_disk(key, value)
        while len(self._store) > self._max:
            self._store.popitem(last=False)
        return value

    def __contains__(self, key: str) -> bool:
        return key in self._store

    def __len__(self) -> int:
        return len(self._store)

    def clear(self) -> None:
        self._store.clear()
