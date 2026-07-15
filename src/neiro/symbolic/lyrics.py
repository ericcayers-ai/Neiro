"""LRC lyrics export (roadmap §8.2 "lyrics -> synced meta events")."""

from __future__ import annotations

from pathlib import Path

from neiro.engine.artifacts import LyricStream

__all__ = ["write_lrc"]


def _lrc_timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    minutes = int(seconds // 60)
    secs = seconds - minutes * 60
    return f"[{minutes:02d}:{secs:05.2f}]"


def write_lrc(
    stream: LyricStream,
    path: str | Path,
    *,
    title: str | None = None,
    artist: str | None = None,
) -> Path:
    """Write a :class:`LyricStream` as a standard ``.lrc`` synced-lyrics file.

    If ``stream`` has no events (e.g. Whisper wasn't installed), writes an LRC
    with a single explanatory comment line rather than an empty/misleading
    file — the "honest software" principle applied to exports.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if title:
        lines.append(f"[ti:{title}]")
    if artist:
        lines.append(f"[ar:{artist}]")
    lines.append("[re:neiro] [tool:neiro-transcribe]")
    if not stream.events:
        lines.append("[00:00.00]# no lyrics decoded (lyrics decoder unavailable or no vocals)")
    else:
        for e in sorted(stream.events, key=lambda ev: ev.start):
            lines.append(f"{_lrc_timestamp(e.start)}{e.text}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
