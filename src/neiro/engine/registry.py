"""Model registry & manifest loading (roadmap §10.2).

Models register by dropping a JSON manifest into a scanned directory. A manifest
names an ``adapter`` as ``module:Class``; the registry imports and instantiates
it on demand. If an adapter's optional dependencies are missing (e.g. a Demucs
manifest on a machine without torch), the manifest is still listed but flagged
``available=False`` and instantiation raises a clear error — the app keeps
running on whatever backends *are* available.

A separate axis, ``downloaded``, tracks whether a model's weights are present
locally (see :mod:`neiro.engine.downloader`). A model can be *available*
(its Python dependency is installed) without being *downloaded* (its weights
haven't been fetched yet) — the two are deliberately independent so the UI and
CLI can say precisely "installed, not yet downloaded" rather than a single
conflated status.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from neiro.engine.downloader import ProgressFn, default_models_dir, fetch_hf_hub, fetch_http

__all__ = ["ModelEntry", "Registry", "default_registry"]


@dataclass
class ModelEntry:
    manifest: dict[str, Any]
    source_path: Path | None = None

    @property
    def id(self) -> str:
        return self.manifest["id"]

    @property
    def task(self) -> str:
        return self.manifest["task"]

    @property
    def display_name(self) -> str:
        return self.manifest.get("display_name", self.id)

    @property
    def stems(self) -> list[str]:
        return list(self.manifest.get("stems", []))

    @property
    def quality_class(self) -> str:
        return self.manifest.get("quality_class", "standard")

    @property
    def license_spdx(self) -> str:
        return self.manifest.get("license", {}).get("spdx", "unknown")

    @property
    def license_note(self) -> str:
        return self.manifest.get("license", {}).get("note", "")

    @property
    def weights(self) -> list[dict[str, Any]]:
        return list(self.manifest.get("weights", []))

    @property
    def needs_download(self) -> bool:
        """False for weight-free models (pure DSP, algorithmic like matchering)."""
        return len(self.weights) > 0

    def _model_dir(self) -> Path:
        d = default_models_dir() / self.id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _marker_path(self) -> Path:
        return default_models_dir() / ".fetched" / f"{self.id}.done"

    def downloaded(self) -> bool:
        """Whether this model's weights are present locally.

        Weight-free models are trivially "downloaded". Otherwise this checks a
        marker file written on a successful :meth:`ensure_downloaded` — cheap
        and correct regardless of which underlying library actually manages the
        cache directory, rather than trying to replicate each library's private
        cache-path convention here.
        """
        if not self.needs_download:
            return True
        return self._marker_path().exists()

    def ensure_downloaded(self, progress: ProgressFn | None = None) -> bool:
        """Fetch this model's weights if not already present. Returns True on success."""
        if self.downloaded():
            return True
        if not self.available():
            raise RuntimeError(
                f"{self.id}: dependencies not installed (requires: "
                f"{', '.join(self.manifest.get('requires', [])) or 'unknown'})"
            )

        model_dir = self._model_dir()
        for spec in self.weights:
            kind = spec.get("kind")
            if kind == "http":
                dest = model_dir / spec["dest"]
                fetch_http(
                    spec["url"],
                    dest,
                    model_id=self.id,
                    sha256=spec.get("sha256"),
                    progress=progress,
                )
            elif kind == "hf_hub":
                fetch_hf_hub(
                    spec["repo_id"],
                    spec["filename"],
                    model_id=self.id,
                    dest_dir=model_dir,
                    revision=spec.get("revision"),
                    progress=progress,
                )
            elif kind == "managed":
                # The adapter's own load() triggers its library's normal
                # download-and-cache path; we've pointed that path at our
                # unified models directory via manifest params (see the
                # adapter's __init__), so this becomes real, tracked download
                # management rather than a scattered, invisible cache.
                adapter = self.instantiate()
                adapter.load("cpu", "fp32")
                unload = getattr(adapter, "unload", None)
                if callable(unload):
                    unload()
            else:
                raise ValueError(f"{self.id}: unknown weight kind {kind!r}")

        marker = self._marker_path()
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(self.id, encoding="utf-8")
        return True

    def _adapter_class(self):
        spec = self.manifest["adapter"]
        module_name, _, class_name = spec.partition(":")
        module = importlib.import_module(module_name)
        return getattr(module, class_name)

    def available(self) -> bool:
        """True if the adapter is importable *and* its declared deps are present.

        Adapters defer heavy imports (torch, demucs, …) to ``load()``, so importing
        the adapter class alone doesn't prove the backend will run. The manifest's
        ``requires`` list names the importable modules the backend needs; we probe
        them with ``find_spec`` (no import side effects).
        """
        import importlib.util

        try:
            self._adapter_class()
        except Exception:
            return False
        for module_name in self.manifest.get("requires", []):
            try:
                if importlib.util.find_spec(module_name) is None:
                    return False
            except (ImportError, ValueError):
                return False
        return True

    def instantiate(self):
        cls = self._adapter_class()
        params = dict(self.manifest.get("params", {}))
        params.setdefault("model_id", self.id)
        # Point the adapter's own cache/checkpoint kwarg at our unified models
        # directory so every model's weights land in one predictable,
        # storage-budgeted place — never scattered across /tmp or a package's
        # private cache. "managed" points at the shared directory (the
        # adapter's library manages filenames within it); "http"/"hf_hub"
        # point at the exact resolved file, letting an adapter that expects a
        # single checkpoint path receive one Neiro has already fetched.
        for spec in self.weights:
            if "cache_param" not in spec:
                continue
            if spec.get("kind") == "managed":
                params.setdefault(spec["cache_param"], str(self._model_dir()))
            elif spec.get("kind") == "http":
                params.setdefault(spec["cache_param"], str(self._model_dir() / spec["dest"]))
        return cls(**params)


class Registry:
    def __init__(self) -> None:
        self._entries: dict[str, ModelEntry] = {}

    def register(self, manifest: dict[str, Any], source: Path | None = None) -> ModelEntry:
        entry = ModelEntry(manifest, source)
        self._entries[entry.id] = entry
        return entry

    def scan_dir(self, directory: Path) -> int:
        count = 0
        if not directory.exists():
            return 0
        for path in sorted(directory.glob("*.json")):
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if "id" in manifest and "task" in manifest and "adapter" in manifest:
                self.register(manifest, path)
                count += 1
        return count

    def get(self, model_id: str) -> ModelEntry:
        return self._entries[model_id]

    def all(self) -> list[ModelEntry]:
        return list(self._entries.values())

    def by_task(self, task: str, *, only_available: bool = False) -> list[ModelEntry]:
        out = [e for e in self._entries.values() if e.task == task]
        if only_available:
            out = [e for e in out if e.available()]
        return out

    def best_for(
        self, task: str, quality: str = "standard", *, stems: set[str] | None = None
    ) -> ModelEntry | None:
        """Pick a usable model for a task, preferring the requested quality tier."""
        order = {"draft": 0, "standard": 1, "reference": 2}
        candidates = self.by_task(task, only_available=True)
        if stems:
            candidates = [e for e in candidates if stems.issubset(set(e.stems))] or candidates
        if not candidates:
            return None
        target = order.get(quality, 1)
        candidates.sort(key=lambda e: abs(order.get(e.quality_class, 1) - target))
        return candidates[0]


def default_registry() -> Registry:
    """A registry seeded from packaged manifests plus granted user plugins."""
    reg = Registry()
    manifest_dir = Path(__file__).resolve().parent.parent / "manifests"
    reg.scan_dir(manifest_dir)
    try:
        from neiro.engine.user_plugins import register_user_plugins

        register_user_plugins(reg)
    except Exception:
        # A malformed local plugin file must not stop the built-in registry from
        # loading; invalid descriptors remain visible through /api/plugins.
        pass
    return reg
