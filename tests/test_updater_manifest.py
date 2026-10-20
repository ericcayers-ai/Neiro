from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location(
        "updater_manifest", ROOT / "scripts" / "updater_manifest.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_manifest_uses_signature_and_release_url(tmp_path):
    module = _load()
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    exe = bundle / "Neiro_1.2.1_x64-setup.exe"
    exe.write_bytes(b"installer")
    exe.with_suffix(".exe.sig").write_text("trusted comment: sig\nabc=\n", encoding="utf-8")

    manifest = module.build_manifest(
        "1.2.1",
        bundle,
        "https://example.test/releases/v1.2.1/",
        "notes",
        now=datetime(2026, 10, 21, tzinfo=timezone.utc),
    )
    platform = manifest["platforms"]["windows-x86_64"]
    assert manifest["version"] == "1.2.1"
    assert manifest["pub_date"] == "2026-10-21T00:00:00Z"
    assert platform["signature"].startswith("trusted comment")
    assert platform["url"] == ("https://example.test/releases/v1.2.1/Neiro_1.2.1_x64-setup.exe")


def test_manifest_requires_installer_and_signature(tmp_path):
    module = _load()
    with pytest.raises(FileNotFoundError):
        module.build_manifest("1.2.1", tmp_path, "https://example.test")
    exe = tmp_path / "Neiro_1.2.1_x64-setup.exe"
    exe.write_bytes(b"x")
    with pytest.raises(FileNotFoundError):
        module.build_manifest("1.2.1", tmp_path, "https://example.test")
    exe.with_suffix(".exe.sig").write_text("   ", encoding="utf-8")
    with pytest.raises(ValueError):
        module.build_manifest("1.2.1", tmp_path, "https://example.test")
