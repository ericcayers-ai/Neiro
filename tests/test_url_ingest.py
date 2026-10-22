"""Tests for URL ingest glue (yt-dlp is mocked — no network)."""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from neiro.cli import main
from neiro.io.url_ingest import (
    fetch_url_audio,
    is_url,
    resolve_input,
)


def test_is_url():
    assert is_url("https://www.youtube.com/watch?v=abc")
    assert is_url("http://example.com/track.mp3")
    assert not is_url("/tmp/song.wav")
    assert not is_url("song.flac")


def test_fetch_url_audio_uses_cache(monkeypatch, tmp_path):
    calls: list[str] = []

    def fake_download(url: str, dest_dir: Path):
        calls.append(url)
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "vid.wav"
        sf.write(str(path), np.zeros(8000, dtype=np.float32), 16000)
        return path, {"id": "vid", "title": "Test Track"}

    monkeypatch.setattr("neiro.io.url_ingest._download_with_ytdlp", fake_download)
    monkeypatch.setattr("neiro.io.url_ingest.importlib.util.find_spec", lambda name: object())

    url = "https://example.com/watch?v=1"
    first = fetch_url_audio(url, dest_dir=tmp_path)
    second = fetch_url_audio(url, dest_dir=tmp_path)

    assert first == second
    assert first.name == "audio.wav"
    assert len(calls) == 1


def test_fetch_url_audio_force_redownload(monkeypatch, tmp_path):
    n = {"v": 0}

    def fake_download(url: str, dest_dir: Path):
        n["v"] += 1
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "vid.wav"
        sf.write(str(path), np.zeros(4000, dtype=np.float32), 16000)
        return path, {"id": "vid", "title": "Again"}

    monkeypatch.setattr("neiro.io.url_ingest._download_with_ytdlp", fake_download)
    monkeypatch.setattr("neiro.io.url_ingest.importlib.util.find_spec", lambda name: object())

    url = "https://example.com/v=2"
    fetch_url_audio(url, dest_dir=tmp_path)
    fetch_url_audio(url, dest_dir=tmp_path, force=True)
    assert n["v"] == 2


def test_missing_ytdlp_is_honest(monkeypatch, tmp_path):
    monkeypatch.setattr("neiro.io.url_ingest.importlib.util.find_spec", lambda name: None)
    try:
        fetch_url_audio("https://example.com/x", dest_dir=tmp_path)
    except RuntimeError as exc:
        assert "yt-dlp" in str(exc)
        assert "neiro[youtube]" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected RuntimeError")


def test_resolve_input_local_file(tmp_path):
    wav = tmp_path / "local.wav"
    sf.write(str(wav), np.zeros(1600, dtype=np.float32), 16000)
    assert resolve_input(str(wav)) == wav.resolve()


def test_cli_ingest_mocked(monkeypatch, tmp_path, capsys):
    def fake_fetch(url: str, *, dest_dir=None, force=False):
        out = (dest_dir or tmp_path) / "audio.wav"
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out), np.zeros(8000, dtype=np.float32), 16000)
        return out

    monkeypatch.setattr("neiro.io.url_ingest.fetch_url_audio", fake_fetch)

    rc = main(["ingest", "https://example.com/track", "--out", str(tmp_path / "copy.wav")])
    assert rc == 0
    out = capsys.readouterr().out.strip()
    assert (tmp_path / "copy.wav").is_file()
    assert out.endswith("copy.wav")


def test_cli_analyze_accepts_url(monkeypatch, tmp_path, capsys):
    wav = tmp_path / "from_url.wav"
    sf.write(str(wav), np.zeros(int(44100 * 0.5), dtype=np.float32), 44100)

    monkeypatch.setattr(
        "neiro.io.url_ingest.fetch_url_audio",
        lambda url, **kw: wav,
    )

    rc = main(["analyze", "https://example.com/song"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["sample_rate"] == 44100


def test_direct_fallback_requires_audio_suffix(monkeypatch, tmp_path):
    monkeypatch.setattr("neiro.io.url_ingest.importlib.util.find_spec", lambda name: None)
    try:
        fetch_url_audio("https://example.com/some/page", dest_dir=tmp_path)
    except RuntimeError as exc:
        assert "direct audio links" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected RuntimeError")


def test_direct_fallback_blocks_loopback(monkeypatch, tmp_path):
    monkeypatch.setattr("neiro.io.url_ingest.importlib.util.find_spec", lambda name: None)
    try:
        fetch_url_audio("http://127.0.0.1/secret.wav", dest_dir=tmp_path)
    except Exception as exc:  # noqa: BLE001 — RequestRejected/ValueError
        assert "not allowed" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("loopback URL must be rejected")


class _FakeResponse:
    def __init__(self, payload: bytes, content_type: str):
        self._payload = payload
        self._offset = 0
        self.headers = self

        class _Headers:
            pass

        self._headers = _Headers()
        self._headers.get_content_type = lambda: content_type  # type: ignore[attr-defined]
        self.headers = self._headers

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size: int = -1) -> bytes:
        if self._offset >= len(self._payload):
            return b""
        end = len(self._payload) if size < 0 else self._offset + size
        chunk = self._payload[self._offset : end]
        self._offset = end
        return chunk


def test_direct_fallback_decodes_mp3(monkeypatch, tmp_path):
    if shutil.which("ffmpeg") is None:  # pragma: no cover
        import pytest

        pytest.skip("ffmpeg not available")
    src = tmp_path / "tone.wav"
    sf.write(str(src), np.sin(np.linspace(0, 2000, 16000)).astype(np.float32) * 0.2, 16000)
    mp3 = tmp_path / "tone.mp3"
    subprocess.run(
        [
            shutil.which("ffmpeg"),
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-codec:a",
            "libmp3lame",
            str(mp3),
        ],
        check=True,
    )
    payload = mp3.read_bytes()
    monkeypatch.setattr(
        "neiro.io.url_ingest.urlopen",
        lambda request, timeout=60: _FakeResponse(payload, "audio/mpeg"),
    )
    from neiro.io.url_ingest import _download_direct

    out = _download_direct("https://example.com/tone.mp3", tmp_path)
    data, rate = sf.read(str(out))
    assert out.name == "audio.wav"
    assert rate > 0 and len(data) > 1000


def test_direct_fallback_rejects_non_audio_content(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "neiro.io.url_ingest.urlopen",
        lambda request, timeout=60: _FakeResponse(b"<html></html>", "text/html"),
    )
    from neiro.io.url_ingest import _download_direct

    try:
        _download_direct("https://example.com/page.wav", tmp_path)
    except RuntimeError as exc:
        assert "did not return audio" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected RuntimeError")
