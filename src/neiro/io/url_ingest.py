"""Fetch audio from web URLs via yt-dlp (optional dependency).

Downloaded files land under :func:`default_url_cache_dir` and are reused when
the same URL is requested again. The result is a local path suitable for
:func:`neiro.io.ingest.load_audio` and the rest of the ingest pipeline.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
from pathlib import Path
from typing import Any

from neiro.engine.downloader import default_neiro_home

__all__ = [
    "URL_PATTERN",
    "default_url_cache_dir",
    "fetch_url_audio",
    "is_url",
    "resolve_input",
]

URL_PATTERN = re.compile(r"^https?://", re.IGNORECASE)


def is_url(value: str) -> bool:
    """True when ``value`` looks like an http(s) URL."""
    return bool(URL_PATTERN.match(value.strip()))


def default_url_cache_dir() -> Path:
    d = default_neiro_home() / "url-ingest"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_ytdlp():
    if importlib.util.find_spec("yt_dlp") is None:
        raise RuntimeError(
            "yt-dlp is not installed — fetch URL audio with: pip install neiro[youtube]"
        )
    import yt_dlp  # noqa: PLC0415

    return yt_dlp


def _download_with_ytdlp(url: str, dest_dir: Path) -> tuple[Path, dict[str, Any]]:
    """Download best available audio for ``url`` into ``dest_dir``. For tests."""
    yt_dlp = _require_ytdlp()
    dest_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(dest_dir / "%(id)s.%(ext)s")
    opts: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:
        name = type(exc).__name__
        msg = str(exc).strip() or name
        if name in ("DownloadError", "ExtractorError", "RegexNotFoundError"):
            raise RuntimeError(f"couldn't download URL ({msg})") from exc
        raise RuntimeError(f"URL download failed ({msg})") from exc

    if info is None:
        raise RuntimeError("couldn't download URL (no metadata returned)")

    video_id = info.get("id") or hashlib.sha256(url.encode()).hexdigest()[:12]
    path = dest_dir / f"{video_id}.wav"
    if not path.is_file():
        # Post-processor may leave a different extension before rename.
        candidates = sorted(dest_dir.glob(f"{video_id}.*"))
        if not candidates:
            raise RuntimeError("couldn't download URL (audio file missing after extract)")
        path = candidates[0]
    return path.resolve(), info


def fetch_url_audio(
    url: str,
    *,
    dest_dir: Path | None = None,
    force: bool = False,
) -> Path:
    """Download (or return cached) audio for ``url`` as a local file path."""
    url = url.strip()
    if not is_url(url):
        raise ValueError(f"not a URL: {url!r}")

    cache_root = dest_dir or default_url_cache_dir()
    url_key = hashlib.sha256(url.encode()).hexdigest()[:16]
    work_dir = cache_root / url_key
    marker = work_dir / ".done"
    cached = work_dir / "audio.wav"

    if not force and marker.is_file() and cached.is_file():
        return cached.resolve()

    work_dir.mkdir(parents=True, exist_ok=True)
    raw_path, info = _download_with_ytdlp(url, work_dir)
    title = info.get("title") or info.get("id") or "audio"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(title)).strip("._") or "audio"
    if not safe.endswith(".wav"):
        safe = f"{safe}.wav"

    if raw_path.resolve() != cached.resolve():
        if cached.is_file():
            cached.unlink()
        raw_path.replace(cached)
    else:
        cached = raw_path

    marker.write_text(f"{url}\n{safe}\n", encoding="utf-8")
    return cached.resolve()


def resolve_input(path_or_url: str, *, force_url: bool = False) -> Path:
    """Return a local path for a filesystem path or downloadable URL."""
    if is_url(path_or_url):
        return fetch_url_audio(path_or_url, force=force_url)
    path = Path(path_or_url)
    if not path.exists():
        raise FileNotFoundError(path_or_url)
    return path.resolve()
