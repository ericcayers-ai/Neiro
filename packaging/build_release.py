"""Assemble the Neiro release bundle.

Produces (under ``dist/``):

* ``neiro-<ver>-py3-none-any.whl`` and ``.tar.gz`` — the Python package.
* ``neiro-core`` — a PyInstaller build of the model-free engine (optional; only
  if ``--exe`` is passed and PyInstaller succeeds).
* ``Neiro-<ver>.zip`` — the one-click bundle: launcher scripts + the wheel +
  (optionally) the standalone executable + docs.

Usage:
    python packaging/build_release.py            # wheel/sdist + launcher zip
    python packaging/build_release.py --exe      # also build the standalone exe

The zip is designed so a non-technical user unzips it and double-clicks one
file. The launchers bootstrap a local venv and install the wheel with the full
neural stack on first run.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "packaging"
DIST = ROOT / "dist"


def _version() -> str:
    ns: dict = {}
    text = (ROOT / "src" / "neiro" / "__init__.py").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("__version__"):
            exec(line, ns)  # noqa: S102 - trusted local source
            return ns["__version__"]
    return "0.0.0"


def build_wheel() -> list[Path]:
    print("== building wheel + sdist ==")
    subprocess.run([sys.executable, "-m", "build"], cwd=ROOT, check=True)
    return sorted(DIST.glob("neiro-*"))


def build_exe() -> Path | None:
    print("== building standalone executable (PyInstaller) ==")
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "PyInstaller",
                str(PKG / "neiro.spec"),
                "--noconfirm",
                "--distpath",
                str(DIST),
                "--workpath",
                str(ROOT / "build" / "pyi"),
            ],
            cwd=PKG,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"   exe build skipped/failed: {exc}")
        return None
    out = DIST / "neiro"
    return out if out.exists() else None


def assemble_zip(version: str, exe_dir: Path | None) -> Path:
    print("== assembling release zip ==")
    staging = DIST / f"Neiro-{version}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    # Launchers + docs at the top level (what the user sees first).
    for item in (PKG / "launchers").iterdir():
        shutil.copy2(item, staging / item.name)
    shutil.copy2(ROOT / "README.md", staging / "README.md")
    shutil.copy2(ROOT / "LICENSE", staging / "LICENSE.txt")
    shutil.copy2(ROOT / "roadmap.md", staging / "roadmap.md")

    # The wheel the launchers install from.
    wheels = staging / "wheels"
    wheels.mkdir()
    # Only the current release wheel — dist/ may still hold older builds.
    whl_files = sorted(DIST.glob(f"neiro-{version}-*.whl"))
    if not whl_files:
        raise FileNotFoundError(
            f"No neiro-{version}-*.whl found in {DIST}; build the wheel first "
            "(omit --zip-only, or run `python -m build`)."
        )
    for whl in whl_files:
        shutil.copy2(whl, wheels / whl.name)

    # Optional standalone build.
    if exe_dir and exe_dir.exists():
        shutil.copytree(exe_dir, staging / "neiro-core")

    # Zip it.
    zip_path = DIST / f"Neiro-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _dirs, files in os.walk(staging):
            for f in files:
                full = Path(dirpath) / f
                z.write(full, full.relative_to(DIST))
    shutil.rmtree(staging)
    print(f"   wrote {zip_path} ({zip_path.stat().st_size / 1e6:.1f} MB)")
    return zip_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--exe", action="store_true", help="also build the standalone executable")
    ap.add_argument(
        "--zip-only",
        action="store_true",
        help="re-assemble the release zip from existing dist/ artifacts",
    )
    args = ap.parse_args()

    DIST.mkdir(exist_ok=True)
    version = _version()
    print(f"Neiro release {version}")

    if args.zip_only:
        exe_dir = DIST / "neiro" if (DIST / "neiro").exists() else None
        zip_path = assemble_zip(version, exe_dir)
        print("\nRelease artifacts:")
        for p in sorted(DIST.glob("neiro-*")) + [zip_path]:
            print(f"  {p.name}")
        return 0

    build_wheel()
    exe_dir = build_exe() if args.exe else None
    zip_path = assemble_zip(version, exe_dir)

    print("\nRelease artifacts:")
    for p in sorted(DIST.glob("neiro-*")) + [zip_path]:
        print(f"  {p.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
