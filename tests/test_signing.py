"""Tests for signed model index helpers."""

from pathlib import Path

from neiro.engine.signing import load_signed_index, sign_index, verify_index, write_signed_index


def test_sign_and_verify_roundtrip(tmp_path: Path):
    secret = b"neiro-test-secret"
    payload = {"manifest_version": 2, "models": [{"id": "dsp-center"}]}
    sig = sign_index(payload, secret)
    assert verify_index(payload, sig, secret)
    assert not verify_index(payload, "deadbeef", secret)

    path = tmp_path / "index.json"
    write_signed_index(path, payload, secret)
    loaded = load_signed_index(path, secret)
    assert loaded["models"][0]["id"] == "dsp-center"
