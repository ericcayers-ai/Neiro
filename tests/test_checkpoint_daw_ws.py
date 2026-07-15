"""Tests for checkpoint store and DAWproject export."""

from pathlib import Path

from neiro.engine.checkpoint import CheckpointStore, JobCheckpoint
from neiro.io.dawproject import write_dawproject_zip, write_folder_layout
from neiro.ui.ws_rpc import RpcRequest, handle_rpc


def test_checkpoint_roundtrip(tmp_path: Path):
    store = CheckpointStore(tmp_path)
    ckpt = JobCheckpoint(job_id="abc")
    ckpt.mark_node_done("separate", "key1")
    ckpt.mark_chunk_done("separate", "chunk0")
    store.save(ckpt)
    loaded = store.load("abc")
    assert loaded.node_done("separate", "key1")
    assert loaded.chunk_done("separate", "chunk0")


def test_dawproject_zip(tmp_path: Path):
    stem = tmp_path / "vocals.wav"
    stem.write_bytes(b"RIFF....")
    out = write_dawproject_zip(
        tmp_path / "song.dawproject",
        song_name="demo",
        stems={"vocals": stem},
        provenance={"model": "dsp-center"},
    )
    assert out.is_file() and out.stat().st_size > 20
    folder = write_folder_layout(tmp_path / "out", song_name="demo", stems={"vocals": stem})
    assert (folder / "provenance.json").is_file()


def test_ws_rpc_health():
    req = RpcRequest(method="health", id=1)
    resp = handle_rpc(req, health=lambda: {"status": "ok"})
    assert resp.error is None
    assert resp.result["status"] == "ok"
