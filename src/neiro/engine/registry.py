"""Model registry & manifest loading (roadmap §10.2).

Models register by dropping a JSON manifest into a scanned directory. A manifest
names an ``adapter`` as ``module:Class``; the registry imports and instantiates
it on demand. If an adapter's optional dependencies are missing (e.g. a Demucs
manifest on a machine without torch), the manifest is still listed but flagged
``available=False`` and instantiation raises a clear error — the app keeps
running on whatever backends *are* available.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
    """A registry seeded from the packaged manifests directory."""
    reg = Registry()
    manifest_dir = Path(__file__).resolve().parent.parent / "manifests"
    reg.scan_dir(manifest_dir)
    return reg
