"""Content-addressed artifact cache (roadmap §2.2, §11 I/O discipline).

Keys are derived from the hashes of a node's inputs, its configuration, and the
version of any model it uses. Re-running a job with one changed parameter
recomputes only the affected subgraph; unchanged nodes return cached results.

The in-memory layer is a plain LRU. The optional disk layer is versioned:
bulk float data (an :class:`~neiro.engine.artifacts.AudioTensor`'s samples, or
any numpy array nested inside a cached value) is written as a numpy ``.npz``
sidecar instead of pickle, with the rest of the value encoded as a small JSON
skeleton. A sha256 sidecar hash covers both files so a truncated write or a
tampered cache directory is detected and evicted rather than silently
deserialized. Pickle is only ever used to *read* cache directories written by
Neiro <0.5 (and only once — a successful legacy read is immediately
rewritten in the current format), never to write new entries: pickle executes
arbitrary code on load, which is a bad trade for a cache whose whole point is
"safe to delete and safe to trust."
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import io
import json
import pickle
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any

import numpy as np

__all__ = ["ArtifactCache", "cache_key", "CACHE_FORMAT_VERSION"]

CACHE_FORMAT_VERSION = 2

# Only classes from these modules may be reconstructed from a cached JSON
# skeleton — an explicit allowlist, not "whatever importlib can find", since
# the cache directory is something a user could hand-edit or copy from
# elsewhere.
_ALLOWED_DATACLASS_MODULES = {"neiro.engine.artifacts"}

# Default disk budget: generous enough for a real working session's stems and
# analysis reports without letting the cache directory grow unbounded forever.
_DEFAULT_DISK_BUDGET_BYTES = 2_000_000_000


def cache_key(node_id: str, config_repr: str, input_keys: list[str]) -> str:
    h = hashlib.sha256()
    h.update(node_id.encode())
    h.update(b"\x00")
    h.update(config_repr.encode())
    for k in sorted(input_keys):
        h.update(b"\x00")
        h.update(k.encode())
    return h.hexdigest()[:32]


def _encode(value: Any, arrays: dict[str, np.ndarray]) -> Any:
    """Recursively turn ``value`` into a JSON-safe skeleton.

    Numpy arrays are spilled into ``arrays`` (keyed by a synthetic name) so
    bulk float/int data lands in the ``.npz`` sidecar instead of inline JSON.
    """
    if isinstance(value, np.ndarray):
        name = f"a{len(arrays)}"
        arrays[name] = value
        return {"__ndarray__": name}
    if isinstance(value, dict):
        return {"__dict__": {k: _encode(v, arrays) for k, v in value.items()}}
    if isinstance(value, tuple):
        return {"__tuple__": [_encode(v, arrays) for v in value]}
    if isinstance(value, list):
        return {"__list__": [_encode(v, arrays) for v in value]}
    if is_dataclass(value) and not isinstance(value, type):
        cls = type(value)
        if cls.__module__ not in _ALLOWED_DATACLASS_MODULES:
            raise TypeError(f"cache: refusing to serialize {cls!r} (not in the allowlist)")
        return {
            "__dataclass__": {"module": cls.__module__, "qualname": cls.__qualname__},
            "fields": {f.name: _encode(getattr(value, f.name), arrays) for f in fields(value)},
        }
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise TypeError(f"cache: don't know how to serialize {type(value)!r}")


def _decode(node: Any, arrays: dict[str, np.ndarray]) -> Any:
    if isinstance(node, dict):
        if "__ndarray__" in node:
            return arrays[node["__ndarray__"]]
        if "__dict__" in node:
            return {k: _decode(v, arrays) for k, v in node["__dict__"].items()}
        if "__tuple__" in node:
            return tuple(_decode(v, arrays) for v in node["__tuple__"])
        if "__list__" in node:
            return [_decode(v, arrays) for v in node["__list__"]]
        if "__dataclass__" in node:
            info = node["__dataclass__"]
            if info["module"] not in _ALLOWED_DATACLASS_MODULES:
                raise ValueError(f"cache: refusing to load class from {info['module']!r}")
            module = importlib.import_module(info["module"])
            cls: Any = module
            for part in info["qualname"].split("."):
                cls = getattr(cls, part)
            kwargs = {k: _decode(v, arrays) for k, v in node["fields"].items()}
            return cls(**kwargs)
        raise ValueError(f"cache: unrecognised node {node!r}")
    return node


class ArtifactCache:
    def __init__(
        self,
        max_entries: int = 256,
        disk_dir: str | Path | None = None,
        *,
        disk_budget_bytes: int | None = _DEFAULT_DISK_BUDGET_BYTES,
    ) -> None:
        self._store: OrderedDict[str, Any] = OrderedDict()
        self._max = max_entries
        self.hits = 0
        self.misses = 0
        self.disk_dir = Path(disk_dir) if disk_dir else None
        self.disk_budget_bytes = disk_budget_bytes
        if self.disk_dir is not None:
            self.disk_dir.mkdir(parents=True, exist_ok=True)

    # -- disk paths -----------------------------------------------------------

    def _meta_path(self, key: str) -> Path:
        assert self.disk_dir is not None
        return self.disk_dir / f"{key}.meta.json"

    def _json_path(self, key: str) -> Path:
        assert self.disk_dir is not None
        return self.disk_dir / f"{key}.data.json"

    def _npz_path(self, key: str) -> Path:
        assert self.disk_dir is not None
        return self.disk_dir / f"{key}.data.npz"

    def _legacy_pkl_path(self, key: str) -> Path:
        assert self.disk_dir is not None
        return self.disk_dir / f"{key}.pkl"

    def _remove_entry_files(self, key: str) -> None:
        for p in (self._meta_path(key), self._json_path(key), self._npz_path(key)):
            p.unlink(missing_ok=True)

    # -- versioned read/write ---------------------------------------------------

    def _write_versioned(self, key: str, value: Any, *, provenance: tuple[str, ...] = ()) -> None:
        arrays: dict[str, np.ndarray] = {}
        skeleton = _encode(value, arrays)
        skeleton_bytes = json.dumps(skeleton, sort_keys=True).encode("utf-8")

        npz_path = self._npz_path(key)
        if arrays:
            buf = io.BytesIO()
            np.savez(buf, **arrays)
            npz_bytes = buf.getvalue()
            npz_path.write_bytes(npz_bytes)
        else:
            npz_bytes = b""
            npz_path.unlink(missing_ok=True)

        self._json_path(key).write_bytes(skeleton_bytes)
        digest = hashlib.sha256(skeleton_bytes + npz_bytes).hexdigest()
        meta = {
            "version": CACHE_FORMAT_VERSION,
            "sha256": digest,
            "created_at": time.time(),
            "size_bytes": len(skeleton_bytes) + len(npz_bytes),
            "provenance": list(provenance),
        }
        self._meta_path(key).write_text(json.dumps(meta), encoding="utf-8")

    def _read_versioned(self, key: str) -> Any | None:
        meta_path, json_path = self._meta_path(key), self._json_path(key)
        if not meta_path.is_file() or not json_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            skeleton_bytes = json_path.read_bytes()
            npz_path = self._npz_path(key)
            npz_bytes = npz_path.read_bytes() if npz_path.is_file() else b""
            digest = hashlib.sha256(skeleton_bytes + npz_bytes).hexdigest()
            if digest != meta.get("sha256"):
                raise ValueError(f"integrity check failed for cache entry {key!r}")
            arrays: dict[str, np.ndarray] = {}
            if npz_bytes:
                with np.load(io.BytesIO(npz_bytes)) as npz:
                    arrays = {name: npz[name] for name in npz.files}
            skeleton = json.loads(skeleton_bytes)
            return _decode(skeleton, arrays)
        except Exception:
            self._remove_entry_files(key)
            return None

    def metadata(self, key: str) -> dict[str, Any] | None:
        """Peek at a disk entry's sidecar (version, size, provenance) without loading it."""
        if self.disk_dir is None:
            return None
        path = self._meta_path(key)
        if not path.is_file():
            return None
        with contextlib.suppress(Exception):
            return json.loads(path.read_text(encoding="utf-8"))
        return None

    # -- legacy pickle read (read-once, then upgraded) ---------------------------

    def _read_legacy_pickle(self, key: str) -> Any | None:
        path = self._legacy_pkl_path(key)
        if not path.is_file():
            return None
        try:
            data = path.read_bytes()
            # Older Neiro versions wrote no sidecar hash at all; if one happens
            # to exist (e.g. copied from a build that added one), honor it.
            sidecar = path.with_suffix(path.suffix + ".sha256")
            if sidecar.is_file():
                expected = sidecar.read_text(encoding="utf-8").strip()
                if hashlib.sha256(data).hexdigest() != expected:
                    raise ValueError(f"legacy cache entry {key!r} failed integrity check")
            value = pickle.loads(data)  # noqa: S301 - legacy read path only
        except Exception:
            path.unlink(missing_ok=True)
            return None
        # Upgrade in place: this legacy branch is only ever exercised once per
        # entry, after which it lives in the current, non-pickle format.
        with contextlib.suppress(Exception):
            self._write_versioned(key, value, provenance=("upgraded-from-legacy-pickle",))
            path.unlink(missing_ok=True)
            path.with_suffix(path.suffix + ".sha256").unlink(missing_ok=True)
        return value

    # -- eviction -----------------------------------------------------------

    def _disk_entries(self) -> list[tuple[float, str, int]]:
        """``[(created_at, key, size_bytes), ...]`` for every versioned entry on disk."""
        if self.disk_dir is None:
            return []
        out = []
        for meta_path in self.disk_dir.glob("*.meta.json"):
            key = meta_path.name[: -len(".meta.json")]
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append((float(meta.get("created_at", 0.0)), key, int(meta.get("size_bytes", 0))))
        return out

    def _evict_disk_if_needed(self) -> None:
        if self.disk_dir is None or self.disk_budget_bytes is None:
            return
        entries = self._disk_entries()
        total = sum(size for _, _, size in entries)
        if total <= self.disk_budget_bytes:
            return
        for _created_at, key, size in sorted(entries):  # oldest first
            if total <= self.disk_budget_bytes:
                break
            self._remove_entry_files(key)
            total -= size

    def disk_usage_bytes(self) -> int:
        return sum(size for _, _, size in self._disk_entries())

    # -- public API -----------------------------------------------------------

    def _read_disk(self, key: str) -> Any | None:
        if self.disk_dir is None:
            return None
        value = self._read_versioned(key)
        if value is not None:
            return value
        return self._read_legacy_pickle(key)

    def _write_disk(self, key: str, value: Any, *, provenance: tuple[str, ...] = ()) -> None:
        if self.disk_dir is None:
            return
        with contextlib.suppress(Exception):
            self._write_versioned(key, value, provenance=provenance)
            self._evict_disk_if_needed()

    def get_or_compute(
        self,
        key: str,
        compute: Callable[[], Any],
        *,
        provenance: tuple[str, ...] = (),
    ) -> Any:
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
        self._write_disk(key, value, provenance=provenance)
        while len(self._store) > self._max:
            self._store.popitem(last=False)
        return value

    def __contains__(self, key: str) -> bool:
        return key in self._store

    def __len__(self) -> int:
        return len(self._store)

    def clear(self) -> None:
        self._store.clear()
