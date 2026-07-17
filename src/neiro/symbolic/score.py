"""Engraved score export: MusicXML always, PDF when a renderer is present
(roadmap §9.4 "print/PDF export matching the on-screen engraving").

Real engraving (Verovio, MuseScore) is optional and heavy; this module always
produces the dependency-free MusicXML, then *tries*, in order:

1. ``verovio`` (pip-installable, pure WASM/C++ engraving engine) to render an
   SVG, and if the ``musescore``/``mscore`` CLI is also on ``PATH``, a real
   PDF via that CLI (Verovio's own PDF backend needs an external Cairo/PDF
   toolchain we don't want to hard-require).
2. The ``musescore``/``mscore`` CLI alone (it can render MusicXML -> PDF/SVG
   directly, no verovio needed).
3. Neither present: writes a plain, real SVG placeholder page (not fake PDF
   bytes) stating plainly that no engraving renderer was found, and how to
   get one — the "honest software" principle applied to exports.

Every path is recorded in the returned dict's ``notes`` so provenance is
never ambiguous about what actually produced the file on disk.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from neiro.engine.artifacts import Timeline
from neiro.symbolic.musicxml import write_musicxml
from neiro.util import subprocess_win

__all__ = [
    "export_score",
    "find_score_renderer",
    "write_musescore_override",
    "clear_musescore_override",
]


def _musescore_override_path() -> Path:
    from neiro.engine.downloader import default_neiro_home

    return default_neiro_home() / "musescore_path.txt"


def write_musescore_override(path: str) -> None:
    """Persist a user-selected MuseScore CLI path (Prefs browse)."""
    target = _musescore_override_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(path.strip(), encoding="utf-8")


def clear_musescore_override() -> None:
    target = _musescore_override_path()
    if target.is_file():
        target.unlink()


def find_score_renderer() -> str | None:
    """Path to a MuseScore CLI binary: env, Prefs override, then PATH."""
    import os

    env = (os.environ.get("NEIRO_MUSESCORE") or "").strip().strip('"')
    if env and Path(env).is_file():
        return str(Path(env).resolve())
    override = _musescore_override_path()
    if override.is_file():
        raw = override.read_text(encoding="utf-8").strip().strip('"')
        if raw and Path(raw).is_file():
            return str(Path(raw).resolve())
    for name in ("musescore", "musescore4", "musescore3", "mscore", "mscore4", "mscore3"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _musescore_render(binary: str, musicxml_path: Path, out_path: Path) -> bool:
    try:
        result = subprocess_win.run(
            [binary, str(musicxml_path), "-o", str(out_path)],
            capture_output=True,
            timeout=120,
            check=False,
        )
        return result.returncode == 0 and out_path.is_file()
    except (OSError, subprocess.SubprocessError):
        return False


def _verovio_render_svg(musicxml_path: Path, svg_path: Path) -> bool:
    try:
        import verovio
    except ImportError:
        return False
    try:
        tk = verovio.toolkit()
        if not tk.loadFile(str(musicxml_path)):
            return False
        svg = tk.renderToSVG()
        svg_path.write_text(svg, encoding="utf-8")
        return True
    except Exception:
        return False


def _placeholder_svg(timeline: Timeline, path: Path, note: str) -> None:
    total = timeline.total_events()
    tracks = ", ".join(timeline.track_names()) or "(no tracks)"
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300" '
        'viewBox="0 0 800 300">\n'
        '  <rect width="800" height="300" fill="#0e1116"/>\n'
        '  <text x="24" y="48" font-family="sans-serif" font-size="20" fill="#e8ecf1">'
        "Neiro transcription — engraving unavailable</text>\n"
        f'  <text x="24" y="84" font-family="sans-serif" font-size="14" fill="#98a0ad">{note}</text>\n'
        f'  <text x="24" y="112" font-family="sans-serif" font-size="14" fill="#98a0ad">'
        f"{total} notes across: {tracks}</text>\n"
        '  <text x="24" y="150" font-family="monospace" font-size="12" fill="#6b7280">'
        "Install verovio (pip) or MuseScore (musescore/mscore on PATH) for real "
        "engraving, or open the accompanying .musicxml in any notation app.</text>\n"
        "</svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def export_score(
    timeline: Timeline,
    base_path: str | Path,
    *,
    key: str | None = None,
    title: str = "Neiro transcription",
    want_pdf: bool = True,
) -> dict:
    """Write MusicXML plus the best available rendering, next to ``base_path``.

    ``base_path`` is used without its suffix as the stem for
    ``{stem}.musicxml`` / ``{stem}.svg`` / ``{stem}.pdf``. Returns a dict with
    the paths actually written and a ``notes`` list explaining the renderer
    chain — attach this to export provenance.
    """
    base = Path(base_path)
    base.parent.mkdir(parents=True, exist_ok=True)
    stem = base.with_suffix("")
    musicxml_path = stem.with_suffix(".musicxml")
    write_musicxml(timeline, musicxml_path, key=key, title=title)

    result: dict = {"musicxml_path": str(musicxml_path), "notes": [], "renderer": "none"}
    svg_path = stem.with_suffix(".svg")
    pdf_path = stem.with_suffix(".pdf")

    if _verovio_render_svg(musicxml_path, svg_path):
        result["svg_path"] = str(svg_path)
        result["renderer"] = "verovio"
        result["notes"].append("rendered SVG via verovio")
        binary = find_score_renderer() if want_pdf else None
        if binary and _musescore_render(binary, musicxml_path, pdf_path):
            result["pdf_path"] = str(pdf_path)
            result["notes"].append(f"rendered PDF via {Path(binary).name}")
        elif want_pdf:
            result["notes"].append(
                "PDF unavailable: no musescore/mscore on PATH; SVG + MusicXML written instead"
            )
        return result

    binary = find_score_renderer()
    if binary:
        made_pdf = want_pdf and _musescore_render(binary, musicxml_path, pdf_path)
        made_svg = _musescore_render(binary, musicxml_path, svg_path)
        if made_pdf:
            result["pdf_path"] = str(pdf_path)
        if made_svg:
            result["svg_path"] = str(svg_path)
        if made_pdf or made_svg:
            result["renderer"] = Path(binary).name
            result["notes"].append(f"rendered via {Path(binary).name}")
            return result

    note = "no engraving renderer found (verovio not importable, no musescore/mscore on PATH)"
    _placeholder_svg(timeline, svg_path, note)
    result["svg_path"] = str(svg_path)
    result["renderer"] = "placeholder"
    result["notes"].append(note + " — wrote MusicXML + a placeholder SVG, not a fake PDF")
    return result
