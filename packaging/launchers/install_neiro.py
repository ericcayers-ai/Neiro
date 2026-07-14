"""Bootstrap install of the bundled Neiro wheel into the local venv.

Handles a common Windows failure: antivirus / indexer locks newly written
console scripts (e.g. torchfrtrace.exe) during pip install, causing
WinError 2 on the .deleteme rename. Strategy:

* Prefer a short local temp dir under LOCALAPPDATA (avoids OneDrive).
* Pre-install torch alone (biggest script writer) with retries.
* Install the wheel [all] extras with retries and --no-cache-dir.
* Clean leftover *.deleteme / partial torch scripts between attempts.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WHEELS = ROOT / "wheels"
MAX_ATTEMPTS = 4


def _local_tmp() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "neiro-pip-tmp"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _find_wheel() -> Path:
    wheels = sorted(WHEELS.glob("neiro-*.whl"))
    if not wheels:
        raise SystemExit(f"No Neiro wheel found in {WHEELS}")
    return wheels[-1]


def _run_pip(args: list[str]) -> int:
    cmd = [sys.executable, "-m", "pip", *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.call(cmd)


def _cleanup_partial_scripts() -> None:
    scripts = Path(sys.executable).resolve().parent
    if scripts.name.lower() != "scripts":
        return
    for pattern in ("*.deleteme", "torch*.exe*", "torch*.exe"):
        for path in scripts.glob(pattern):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def _pip_with_retries(args: list[str], label: str) -> None:
    last = 1
    for attempt in range(1, MAX_ATTEMPTS + 1):
        print(f"\n== {label} (attempt {attempt}/{MAX_ATTEMPTS}) ==", flush=True)
        last = _run_pip(args)
        if last == 0:
            return
        _cleanup_partial_scripts()
        if attempt < MAX_ATTEMPTS:
            wait = attempt * 2
            print(f"Install hit a Windows file lock; retrying in {wait}s...", flush=True)
            time.sleep(wait)
    raise SystemExit(
        f"{label} failed after {MAX_ATTEMPTS} attempts (exit {last}).\n"
        "Close antivirus scanning briefly, delete the .venv folder, extract Neiro\n"
        "to a local folder such as C:\\Neiro (not OneDrive/Desktop sync), and re-run."
    )


def main() -> int:
    tmp = _local_tmp()
    os.environ["TEMP"] = str(tmp)
    os.environ["TMP"] = str(tmp)
    tempfile.tempdir = str(tmp)

    wheel = _find_wheel()
    print(f"Using wheel: {wheel}", flush=True)

    _run_pip(["install", "--upgrade", "pip", "setuptools", "wheel"])

    # Torch alone writes several Scripts\\*.exe — do this before the big resolve.
    _pip_with_retries(
        ["install", "--no-cache-dir", "torch>=2.3"],
        "Installing torch",
    )

    _pip_with_retries(
        ["install", "--no-cache-dir", f"{wheel}[all]"],
        "Installing Neiro[all]",
    )

    try:
        import neiro  # noqa: F401
    except ImportError as exc:
        raise SystemExit(f"Neiro installed but import failed: {exc}") from exc

    print(f"\nNeiro {neiro.__version__} ready.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130) from None
