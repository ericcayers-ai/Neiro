"""Dynamic port contract: --port 0 binds an OS port and reports it in the file."""

from __future__ import annotations

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _stop(proc: subprocess.Popen[str]) -> str:
    """Terminate the child and return everything it printed.

    The child's output is the only description of a startup failure, so it is read
    back on every exit path instead of being left in a pipe.
    """
    if proc.poll() is None:
        proc.terminate()
    try:
        out, _ = proc.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
    return out or ""


def test_ephemeral_port_is_written_and_serves(tmp_path):
    port_file = tmp_path / "port.txt"
    # ``-u`` keeps the child's banner and any traceback unbuffered: a startup crash
    # on a runner would otherwise be an empty pipe and a bare assertion failure.
    proc = subprocess.Popen(
        [
            sys.executable,
            "-u",
            "-m",
            "neiro.cli",
            "ui",
            "--no-browser",
            "--port",
            "0",
            "--port-file",
            str(port_file),
        ],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 60
        while time.time() < deadline and not port_file.is_file():
            if proc.poll() is not None:
                break
            time.sleep(0.2)
        if not port_file.is_file():
            output = _stop(proc)
            raise AssertionError(
                "server did not write the port file"
                f" (exit={proc.returncode}, platform={sys.platform})\n{output}"
            )
        port = int(port_file.read_text(encoding="utf-8").strip())
        assert port > 0
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as resp:
            assert resp.status == 200
    finally:
        if proc.poll() is None:
            _stop(proc)
