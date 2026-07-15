"""Minimal DAWproject / folder-per-song export (roadmap §5.6)."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any


def write_folder_layout(
    out_dir: Path,
    *,
    song_name: str,
    stems: dict[str, Path],
    provenance: dict[str, Any] | None = None,
) -> Path:
    """Write ``{out_dir}/{song_name}/`` with stem files + provenance.json."""
    dest = Path(out_dir) / song_name
    dest.mkdir(parents=True, exist_ok=True)
    for name, src in stems.items():
        target = dest / Path(src).name
        if Path(src).resolve() != target.resolve():
            target.write_bytes(Path(src).read_bytes())
    meta = {"song": song_name, "stems": list(stems), "provenance": provenance or {}}
    (dest / "provenance.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return dest


def write_dawproject_zip(
    out_path: Path,
    *,
    song_name: str,
    stems: dict[str, Path],
    provenance: dict[str, Any] | None = None,
) -> Path:
    """Write a minimal DAWproject-compatible zip (audio + project.xml + provenance).

    This is intentionally a lightweight interchange package: enough for DAWs that
    can import loose audio + a simple project listing, with full provenance for Neiro.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tracks_xml = []
    for i, (name, src) in enumerate(stems.items()):
        tracks_xml.append(
            f'  <Track id="{i}" name="{name}" content="audio/{Path(src).name}"/>'
        )
    project_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<Project name="{song_name}" version="1.0">\n'
        + "\n".join(tracks_xml)
        + "\n</Project>\n"
    )
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.xml", project_xml)
        zf.writestr(
            "provenance.json",
            json.dumps({"song": song_name, "provenance": provenance or {}}, indent=2),
        )
        for name, src in stems.items():
            zf.write(src, arcname=f"audio/{Path(src).name}")
    return out_path
