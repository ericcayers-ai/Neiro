"""Discovery and grant handling for local user Python plugins.

Plugins are ordinary Python adapters declared by
``~/.neiro/plugins/<plugin>/plugin.json``. Because loading an adapter grants code
execution in the Neiro process, descriptors are only registered after both the
descriptor's ``enabled`` flag and the local grants file opt in.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from neiro.engine.session import default_home

__all__ = [
    "ROLE_TASKS",
    "UserPlugin",
    "default_plugins_dir",
    "discover_plugins",
    "load_grants",
    "register_user_plugins",
    "save_grants",
    "set_plugin_grants",
]

ROLE_TASKS = {
    "enhancer": "enhance",
    "separator": "separate",
    "transcriber": "transcribe",
}


def default_plugins_dir() -> Path:
    return default_home() / "plugins"


def _plugin_key(raw: str) -> str:
    key = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw.strip()).strip("-._").lower()
    return key or "plugin"


def _grants_path(plugins_dir: Path) -> Path:
    return plugins_dir / "grants.json"


def load_grants(plugins_dir: str | Path | None = None) -> dict[str, bool]:
    """Load the simple grant map from ``grants.json``.

    The canonical format is ``{"granted": {"plugin-key": true}}``. A list form
    is accepted for hand-written files: ``{"granted": ["plugin-key"]}``.
    """

    root = Path(plugins_dir).expanduser() if plugins_dir is not None else default_plugins_dir()
    path = _grants_path(root)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    granted = data.get("granted", data)
    if isinstance(granted, list):
        return {_plugin_key(str(item)): True for item in granted}
    if isinstance(granted, dict):
        return {_plugin_key(str(key)): bool(value) for key, value in granted.items()}
    return {}


def save_grants(grants: dict[str, bool], plugins_dir: str | Path | None = None) -> Path:
    root = Path(plugins_dir).expanduser() if plugins_dir is not None else default_plugins_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = _grants_path(root)
    normalized = {_plugin_key(key): bool(value) for key, value in grants.items()}
    path.write_text(
        json.dumps({"granted": normalized}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


@dataclass(frozen=True)
class UserPlugin:
    key: str
    name: str
    adapter: str
    role: str
    enabled: bool
    granted: bool
    path: Path
    error: str | None = None

    @property
    def task(self) -> str | None:
        return ROLE_TASKS.get(self.role)

    @property
    def registerable(self) -> bool:
        return self.error is None and self.enabled and self.granted and self.task is not None

    def manifest(self) -> dict[str, Any]:
        if self.error is not None or self.task is None:
            raise ValueError(self.error or f"unsupported plugin role {self.role!r}")
        return {
            "manifest_version": 2,
            "id": f"user-plugin-{self.key}",
            "task": self.task,
            "display_name": self.name,
            "adapter": self.adapter,
            "framework": "user-python",
            "quality_class": "standard",
            "params": {},
            "license": {
                "spdx": "NOASSERTION",
                "note": "Local user plugin; review before granting.",
                "source": str(self.path.parent),
            },
            "provenance": {
                "author": "user",
                "plugin_role": self.role,
                "plugin_key": self.key,
            },
        }

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.key,
            "name": self.name,
            "adapter": self.adapter,
            "role": self.role,
            "task": self.task,
            "enabled": self.enabled,
            "granted": self.granted,
            "registered": self.registerable,
            "path": str(self.path),
            "error": self.error,
        }


def _descriptor_from_file(path: Path, grants: dict[str, bool]) -> UserPlugin:
    key = _plugin_key(path.parent.name)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return UserPlugin(key, path.parent.name, "", "", False, False, path, str(exc))

    name = str(data.get("name") or path.parent.name).strip()
    adapter = str(data.get("adapter") or "").strip()
    role = str(data.get("role") or "").strip().lower()
    enabled = bool(data.get("enabled", False))
    granted = bool(grants.get(key, False))

    error = None
    if not name:
        error = "name is required"
    elif not adapter or ":" not in adapter:
        error = "adapter must be an import path like 'module:Class'"
    elif role not in ROLE_TASKS:
        error = f"role must be one of {', '.join(sorted(ROLE_TASKS))}"

    return UserPlugin(key, name, adapter, role, enabled, granted, path, error)


def discover_plugins(plugins_dir: str | Path | None = None) -> list[UserPlugin]:
    root = Path(plugins_dir).expanduser() if plugins_dir is not None else default_plugins_dir()
    grants = load_grants(root)
    if not root.exists():
        return []
    plugins = [_descriptor_from_file(path, grants) for path in sorted(root.glob("*/plugin.json"))]
    plugins.sort(key=lambda plugin: plugin.key)
    return plugins


def register_user_plugins(registry, plugins_dir: str | Path | None = None) -> int:
    count = 0
    for plugin in discover_plugins(plugins_dir):
        if not plugin.registerable:
            continue
        registry.register(plugin.manifest(), plugin.path)
        count += 1
    return count


def set_plugin_grants(
    updates: dict[str, bool], plugins_dir: str | Path | None = None
) -> list[UserPlugin]:
    root = Path(plugins_dir).expanduser() if plugins_dir is not None else default_plugins_dir()
    grants = load_grants(root)
    for key, granted in updates.items():
        grants[_plugin_key(str(key))] = bool(granted)
    save_grants(grants, root)
    return discover_plugins(root)
