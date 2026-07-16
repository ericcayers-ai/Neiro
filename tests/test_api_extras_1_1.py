"""Tests for Neiro 1.1 API extras: plan strip, compute flush, sessions, notes helpers."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager
from neiro.ui.api_extras import (
    flush_vram,
    plan_payload,
    save_session_doc,
    serialize_plan,
    vram_status,
)


def _tone(tmp_path: Path) -> Path:
    path = tmp_path / "tone.wav"
    sr = 16000
    t = np.linspace(0, 0.4, int(sr * 0.4), endpoint=False)
    x = (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    sf.write(path, x, sr)
    return path


def test_plan_payload_separate(tmp_path: Path):
    wav = _tone(tmp_path)
    reg = default_registry()
    vram = VRAMManager()
    payload = plan_payload(
        kind="separate",
        file_path=wav,
        registry=reg,
        vram=vram,
        preset="vocals",
        quality="draft",
        bleed_suppress=False,
    )
    assert payload["kind"] == "separation"
    assert isinstance(payload["nodes"], list)
    assert len(payload["nodes"]) >= 1
    assert isinstance(payload["notes"], list)


def test_serialize_plan_round_shape():

    # Use a tiny in-memory path via tmp — covered above; this asserts helper on empty-ish object
    class FakeNode:
        node_id = "a"
        inputs = {}

        def config_repr(self):
            return "Fake"

    class FakeGraph:
        _nodes = {"a": FakeNode()}

    class FakePlan:
        graph = FakeGraph()
        model_id = "x"
        notes = ["n"]
        quality = "standard"
        stem_ports = ["vocals"]

    out = serialize_plan(FakePlan())
    assert out["nodes"][0]["id"] == "a"
    assert out["model_id"] == "x"


def test_vram_flush_and_status():
    vram = VRAMManager()
    # Admit a tiny fake resident by calling reserve
    vram.reserve("toy-model", fp32_gb=0.01)
    assert "toy-model" in vram.resident_models()
    status = vram_status(vram)
    assert "devices" in status
    flushed = flush_vram(vram)
    assert "toy-model" in flushed["flushed"]
    assert flushed["resident"] == []


def test_session_save(tmp_path: Path, monkeypatch):
    from neiro.engine import session as session_mod

    monkeypatch.setattr(session_mod, "default_home", lambda: tmp_path / "home")
    wav = _tone(tmp_path)
    out = save_session_doc(
        name="demo",
        file_id="abc",
        file_path=wav,
        graph_config={"module": "separate"},
    )
    assert out["ok"] is True
    assert out["name"] == "demo"
    assert Path(out["path"]).is_file()
