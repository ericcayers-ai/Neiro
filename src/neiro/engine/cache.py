"""Content-addressed artifact cache (roadmap §2.2).

Keys are derived from the hashes of a node's inputs, its configuration, and the
version of any model it uses. Re-running a job with one changed parameter
recomputes only the affected subgraph; unchanged nodes return cached results.

The M0 implementation is an in-process LRU. The key derivation is the durable
part — a disk-backed store can be dropped in behind the same interface.
"""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from collections.abc import Callable
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
    def __init__(self, max_entries: int = 256) -> None:
        self._store: OrderedDict[str, Any] = OrderedDict()
        self._max = max_entries
        self.hits = 0
        self.misses = 0

    def get_or_compute(self, key: str, compute: Callable[[], Any]) -> Any:
        if key in self._store:
            self._store.move_to_end(key)
            self.hits += 1
            return self._store[key]
        self.misses += 1
        value = compute()
        self._store[key] = value
        self._store.move_to_end(key)
        while len(self._store) > self._max:
            self._store.popitem(last=False)
        return value

    def __contains__(self, key: str) -> bool:
        return key in self._store

    def __len__(self) -> int:
        return len(self._store)

    def clear(self) -> None:
        self._store.clear()
