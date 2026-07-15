"""Tests for portable sessions and bleed suppression."""

from pathlib import Path

import numpy as np

from neiro.dsp.bleed import suppress_bleed
from neiro.dsp.stereo import from_mid_side, to_mid_side
from neiro.engine.session import ModelPin, SessionDocument, SessionStore, file_fingerprint


def test_session_roundtrip(tmp_path: Path):
    store = SessionStore(tmp_path)
    doc = SessionDocument(
        name="demo",
        source={"sha256": "abc"},
        models=[ModelPin(model_id="dsp-center", license_spdx="builtin")],
        graph_config={"preset": "vocals", "tier": "standard"},
    )
    path = store.save(doc)
    loaded = store.load(path)
    assert loaded.name == "demo"
    assert loaded.models[0].model_id == "dsp-center"
    assert loaded.session_version >= 1


def test_file_fingerprint(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"hello-neiro")
    fp = file_fingerprint(p)
    assert len(fp["sha256"]) == 64
    assert fp["size"] == 11


def test_bleed_reduces_rival_energy():
    sr = 16000
    sr_len = 8000
    t = np.linspace(0, 1, sr_len, endpoint=False)
    target = np.stack([0.5 * np.sin(2 * np.pi * 220 * t)] * 2).astype(np.float32)
    rival = np.stack([0.5 * np.sin(2 * np.pi * 880 * t)] * 2).astype(np.float32)
    polluted = target + 0.4 * rival
    cleaned = suppress_bleed(polluted, [rival], sr, strength=0.8)
    err_before = np.linalg.norm(polluted - target)
    err_after = np.linalg.norm(cleaned - target)
    assert err_after < err_before


def test_mid_side_roundtrip():
    x = np.random.randn(2, 1000).astype(np.float32) * 0.1
    mid, side = to_mid_side(x)
    y = from_mid_side(mid, side)
    assert np.allclose(x, y, atol=1e-5)
