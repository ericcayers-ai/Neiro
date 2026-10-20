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
    parser.add_argument(
        "--install",
        action="store_true",
        help="clean src-tauri/resources/engine (keeping its README) and copy the build in",
    )
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
    if args.install:
        dest = ROOT / "src-tauri" / "resources" / "engine"
        dest.mkdir(parents=True, exist_ok=True)
        readme = dest / "README.txt"
        readme_text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
        for child in dest.iterdir():
            if child.name == "README.txt":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        shutil.copytree(exe.parent, dest, dirs_exist_ok=True)
        (dest / "neiro.exe").replace(dest / "neiro-engine.exe")
        if readme_text:
            readme.write_text(readme_text, encoding="utf-8")
        print(f"installed into {dest} (README preserved)")
        print("Before a release build, also remove src-tauri/target/release/resources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
