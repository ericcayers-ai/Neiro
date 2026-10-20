#!/usr/bin/env python
"""Generate a Tauri v2 updater manifest (`latest.json`) for a release bundle.

The NSIS installer and its `.sig` are produced by `tauri build` when
`bundle.createUpdaterArtifacts` is enabled and the signing key env vars are set.
This script turns them into the JSON the updater endpoint serves.

Example::

    python scripts/updater_manifest.py --version 1.2.1 \
        --base-url https://github.com/ericcayers-ai/Neiro/releases/download/v1.2.1 \
        --out dist/latest.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def build_manifest(
    version: str,
    bundle_dir: Path,
    base_url: str,
    notes: str = "",
    *,
    now: datetime | None = None,
) -> dict:
    exe = bundle_dir / f"Neiro_{version}_x64-setup.exe"
    sig = exe.with_suffix(exe.suffix + ".sig")
    if not exe.is_file():
        raise FileNotFoundError(f"installer not found: {exe}")
    if not sig.is_file():
        raise FileNotFoundError(f"signature not found: {sig}")
    signature = sig.read_text(encoding="utf-8").strip()
    if not signature:
        raise ValueError(f"empty signature: {sig}")
    return {
        "version": version,
        "notes": notes,
        "pub_date": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": signature,
                "url": f"{base_url.rstrip('/')}/{exe.name}",
            }
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument(
        "--bundle-dir",
        default="src-tauri/target/release/bundle/nsis",
        help="directory containing Neiro_<version>_x64-setup.exe and .sig",
    )
    parser.add_argument("--base-url", required=True, help="release asset base URL")
    parser.add_argument("--notes", default="")
    parser.add_argument("--out", default="latest.json")
    args = parser.parse_args()

    manifest = build_manifest(
        args.version,
        Path(args.bundle_dir),
        args.base_url,
        args.notes,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} ({manifest['platforms']['windows-x86_64']['url']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
