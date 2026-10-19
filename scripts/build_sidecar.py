#!/usr/bin/env python
"""Build the model-free Neiro engine as a standalone folder (PyInstaller).

The frozen engine serves the same CLI/API/UI with no system Python. Neural
backends are intentionally excluded (see ``packaging/neiro.spec``); they remain
opt-in installs.

Usage::

    python scripts/build_sidecar.py [--dist dist] [--work build]

Requires PyInstaller in the current interpreter (``uv pip install pyinstaller``).
The output is ``<dist>/neiro/neiro(.exe)``; a Tauri release copies that folder to
``src-tauri/resources/engine/`` so ``lib.rs`` finds it next to the app binary.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", default=str(ROOT / "dist"))
    parser.add_argument("--work", default=str(ROOT / "build" / "neiro-sidecar"))
    args = parser.parse_args()

    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller is not installed: uv pip install pyinstaller", file=sys.stderr)
        return 2

    dist = Path(args.dist).resolve()
    work = Path(args.work).resolve()
    if dist.exists():
        shutil.rmtree(dist)
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(ROOT / "packaging" / "neiro.spec"),
        "--noconfirm",
        "--distpath",
        str(dist),
        "--workpath",
        str(work),
    ]
    print("running:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=str(ROOT), check=False)
    if result.returncode != 0:
        print(f"PyInstaller failed with exit {result.returncode}", file=sys.stderr)
        return result.returncode

    name = "neiro.exe" if sys.platform == "win32" else "neiro"
    exe = dist / "neiro" / name
    if not exe.is_file():
        print(f"expected {exe} to exist", file=sys.stderr)
        return 1
    print(f"built {exe} ({exe.stat().st_size / 1e6:.1f} MB)")
    print("Tauri release: copy the whole folder to src-tauri/resources/engine/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
