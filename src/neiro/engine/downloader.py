"""Model download management (roadmap §9.6, §10.2).

The single place that gets bytes for a model onto disk. Two transport kinds are
supported directly:

* ``http`` — a direct URL, streamed with resume support (HTTP Range) and
  optional SHA-256 verification.
* ``hf_hub`` — a file on the Hugging Face Hub, fetched through
  ``huggingface_hub`` (which itself resumes and content-addresses under the hood).

A third kind, ``managed``, covers adapters whose own library already downloads
and caches weights on first use (``audio-separator``, ``piano_transcription_inference``).
For those, "downloading" means pointing the library's cache/checkpoint path at
our unified models directory and triggering its normal load path once — see
:func:`ensure_weights`. This keeps every model, regardless of how its upstream
library fetches weights, behind one predictable location and one progress
interface, rather than scattering caches across `/tmp`, `~/.cache`, and package
install directories.

Storage location: never inside a cloud-synced folder by default (OneDrive et
al. thrash badly on multi-GB weight files being written/verified). Resolution
order: ``NEIRO_HOME`` env var, else a platform cache directory.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "DownloadProgress",
    "default_neiro_home",
    "default_models_dir",
    "fetch_http",
    "fetch_hf_hub",
    "verify_sha256",
]

ProgressFn = Callable[["DownloadProgress"], None]


@dataclass
class DownloadProgress:
    model_id: str
    downloaded_bytes: int
    total_bytes: int | None
    stage: str = "downloading"  # downloading | verifying | done

    @property
    def fraction(self) -> float | None:
        if self.total_bytes and self.total_bytes > 0:
            return min(1.0, self.downloaded_bytes / self.total_bytes)
        return None


def default_neiro_home() -> Path:
    """Root directory for everything Neiro persists locally (not the repo)."""
    env = os.environ.get("NEIRO_HOME")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "neiro"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "neiro"
    return Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "neiro"


def default_models_dir() -> Path:
    d = default_neiro_home() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def verify_sha256(path: Path, expected: str) -> bool:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().lower() == expected.lower()


def fetch_http(
    url: str,
    dest: Path,
    *,
    model_id: str = "",
    sha256: str | None = None,
    progress: ProgressFn | None = None,
    timeout: float = 30.0,
) -> Path:
    """Stream ``url`` to ``dest`` with resume support and optional verification.

    Resumes an interrupted download via an HTTP Range request if a partial
    ``dest.part`` file exists. Verifies SHA-256 when ``sha256`` is given; a
    mismatch removes the corrupt file and raises rather than leaving a bad
    weight file that would fail confusingly deep inside model inference.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and sha256 and verify_sha256(dest, sha256):
        if progress:
            progress(DownloadProgress(model_id, dest.stat().st_size, dest.stat().st_size, "done"))
        return dest
    if dest.exists() and sha256 is None:
        # No checksum to verify against; treat an existing non-empty file as
        # already fetched rather than re-downloading on every call.
        if progress:
            progress(DownloadProgress(model_id, dest.stat().st_size, dest.stat().st_size, "done"))
        return dest

    part = dest.with_suffix(dest.suffix + ".part")
    resume_from = part.stat().st_size if part.exists() else 0

    req = urllib.request.Request(url)
    if resume_from:
        req.add_header("Range", f"bytes={resume_from}-")

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        total = resp.headers.get("Content-Length")
        total_bytes = (int(total) + resume_from) if total is not None else None
        mode = "ab" if resume_from else "wb"
        downloaded = resume_from
        with open(part, mode) as f:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if progress:
                    progress(DownloadProgress(model_id, downloaded, total_bytes, "downloading"))

    if sha256:
        if progress:
            progress(DownloadProgress(model_id, downloaded, downloaded, "verifying"))
        if not verify_sha256(part, sha256):
            part.unlink(missing_ok=True)
            raise ValueError(f"SHA-256 mismatch downloading {model_id or url} — file discarded")

    part.replace(dest)
    if progress:
        progress(DownloadProgress(model_id, downloaded, downloaded, "done"))
    return dest


def fetch_hf_hub(
    repo_id: str,
    filename: str,
    *,
    model_id: str = "",
    dest_dir: Path | None = None,
    revision: str | None = None,
    progress: ProgressFn | None = None,
) -> Path:
    """Fetch a file from the Hugging Face Hub into ``dest_dir``.

    Requires ``huggingface_hub`` (an optional dependency — see the
    ``downloader`` extra). ``huggingface_hub`` handles resume and content
    addressing internally; we report only a start/done progress pair since it
    doesn't expose byte-level callbacks through the simple download function.
    """
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as exc:
        raise RuntimeError(
            "fetching from the Hugging Face Hub requires 'huggingface_hub' "
            "(pip install neiro[downloader])"
        ) from exc

    if progress:
        progress(DownloadProgress(model_id, 0, None, "downloading"))
    path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        revision=revision,
        cache_dir=str(dest_dir) if dest_dir else None,
    )
    if progress:
        size = Path(path).stat().st_size
        progress(DownloadProgress(model_id, size, size, "done"))
    return Path(path)


def atomic_tempfile(suffix: str = "") -> Path:
    """A path inside the system temp dir, for callers assembling files before a move."""
    fd, name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return Path(name)
