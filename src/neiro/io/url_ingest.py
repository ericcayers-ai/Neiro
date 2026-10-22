"""Fetch audio from web URLs via yt-dlp (optional dependency).

Downloaded files land under :func:`default_url_cache_dir` and are reused when
the same URL is requested again. The result is a local path suitable for
:func:`neiro.io.ingest.load_audio` and the rest of the ingest pipeline.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from neiro.engine.downloader import default_neiro_home
from neiro.ui.security import check_outbound_url

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


AUDIO_SUFFIXES = {".wav", ".flac", ".ogg", ".oga", ".mp3", ".m4a", ".aac", ".opus", ".webm"}
MAX_DIRECT_BYTES = 512 * 1024 * 1024


def _download_direct(url: str, dest_dir: Path) -> Path:
    """Fetch a direct audio link without yt-dlp, converting to WAV with ffmpeg.

    Only used when yt-dlp is absent; the caller has already passed the URL
    through ``check_outbound_url`` (repeated here for CLI callers).
    """
    check_outbound_url(url)
    suffix = Path(urlsplit(url).path).suffix.lower()
    if suffix not in AUDIO_SUFFIXES:
        raise RuntimeError(
            "yt-dlp is not installed — direct audio links (.wav/.flac/.ogg/.mp3/.m4a) "
            "are supported, or install it with: pip install neiro[youtube]"
        )
    request = Request(url, headers={"User-Agent": "Neiro/1.2 (+local)"})
    with tempfile.NamedTemporaryFile(dir=dest_dir, suffix=suffix, delete=False) as raw:
        raw_path = Path(raw.name)
        total = 0
        with urlopen(request, timeout=60) as response:  # noqa: S310 — checked above
            content_type = (response.headers.get_content_type() or "").lower()
            if not (
                content_type.startswith("audio/")
                or content_type in {"application/ogg", "application/octet-stream"}
            ):
                raw.close()
                raw_path.unlink(missing_ok=True)
                raise RuntimeError(f"URL did not return audio ({content_type or 'unknown type'})")
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DIRECT_BYTES:
                    raise RuntimeError("URL audio exceeds the 512 MB direct-download limit")
                raw.write(chunk)
    if total == 0:
        raw_path.unlink(missing_ok=True)
        raise RuntimeError("URL returned an empty file")

    out = dest_dir / "audio.wav"
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        if suffix != ".wav":
            raw_path.unlink(missing_ok=True)
            raise RuntimeError("ffmpeg is required to decode this URL audio (direct .wav works)")
        raw_path.replace(out)
        return out.resolve()
    result = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(raw_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            str(out),
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    raw_path.unlink(missing_ok=True)
    if result.returncode != 0 or not out.is_file():
        raise RuntimeError(f"couldn't decode URL audio ({result.stderr.strip()[-200:]})")
    return out.resolve()


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
    if importlib.util.find_spec("yt_dlp") is None:
        raw_path = _download_direct(url, work_dir)
        info = {"title": Path(urlsplit(url).path).stem or "audio", "id": url_key}
    else:
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
