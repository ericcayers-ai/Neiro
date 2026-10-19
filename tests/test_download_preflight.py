"""Model-download preflight: declared sizes cannot overrun the volume."""

from __future__ import annotations

from collections import namedtuple
from types import SimpleNamespace

import pytest

from neiro.ui import server as server_mod
from neiro.ui.server import _State, download_disk_preflight, start_model_download

_Usage = namedtuple("_Usage", "total used free")


class _Registry:
    def __init__(self, entries):
        self.entries = entries

    def get(self, model_id):
        if model_id not in self.entries:
            raise KeyError(model_id)
        return self.entries[model_id]


def _real_entry(tmp_path, monkeypatch, model_id="demo"):
    from neiro.engine import registry as registry_mod

    monkeypatch.setattr(registry_mod, "default_models_dir", lambda: tmp_path / "models")
    from neiro.engine.registry import ModelEntry

    manifest = {
        "id": model_id,
        "task": "enhance",
        "adapter": "neiro.adapters.dsp_separator:CenterExtractor",
        "weights": [{"kind": "hf_hub", "repo": "x/y"}],
        "license": {"spdx": "MIT"},
    }
    entry = ModelEntry(manifest, tmp_path / "manifest.json")
    return entry


def test_remove_download_only_touches_that_model(tmp_path, monkeypatch):
    entry = _real_entry(tmp_path, monkeypatch)
    models = tmp_path / "models"
    model_dir = models / entry.id
    model_dir.mkdir(parents=True)
    (model_dir / "weights.onnx").write_bytes(b"x" * 1024)
    marker = models / ".fetched" / f"{entry.id}.done"
    marker.parent.mkdir(parents=True)
    marker.write_text(entry.id, encoding="utf-8")
    keep = models / "other-model"
    keep.mkdir()
    (keep / "keep.bin").write_bytes(b"keep")

    result = entry.remove_download()
    assert result["freed_bytes"] == 1024
    assert not model_dir.exists()
    assert not marker.exists()
    assert (keep / "keep.bin").exists(), "unrelated model data must survive"
    assert result["removed"]


def _entry(size: int | None, needs_download: bool = True):
    weights = [{"kind": "hf_hub", "size_bytes": size}] if size is not None else [{"kind": "hf_hub"}]
    return SimpleNamespace(weights=weights, needs_download=needs_download)


def test_preflight_sums_declared_sizes_and_reports_unknown(monkeypatch):
    state = _State()
    state.registry = _Registry({"a": _entry(1_000), "b": _entry(None), "c": _entry(500)})
    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 5, 5_000_000_000))
    needed, free, unknown = download_disk_preflight(state, ["a", "b", "c", "missing"])
    assert needed == 1_500
    assert free == 5_000_000_000
    assert unknown == ["b"]


def test_preflight_rejects_a_download_that_cannot_fit(monkeypatch):
    state = _State()
    state.registry = _Registry({"huge": _entry(9_000_000_000)})
    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 8, 2_000_000_000))
    with pytest.raises(Exception) as exc:
        start_model_download(state, model_ids=["huge"])
    assert getattr(exc.value, "code", None) == 507
    assert not state.jobs, "no job should be created when the preflight fails"


def test_preflight_allows_a_download_that_fits(monkeypatch):
    state = _State()
    state.registry = _Registry({"small": _entry(100_000_000)})
    monkeypatch.setattr(server_mod.shutil, "disk_usage", lambda path: _Usage(10, 2, 8_000_000_000))
    job_id = start_model_download(state, model_ids=["small"])
    assert job_id in state.jobs
