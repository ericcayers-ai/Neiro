"""Dynamic port contract: --port 0 binds an OS port and reports it in the file."""

from __future__ import annotations

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ephemeral_port_is_written_and_serves(tmp_path):
    port_file = tmp_path / "port.txt"
    proc = subprocess.Popen(
        [
            sys.executable,
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
        deadline = time.time() + 30
        while time.time() < deadline and not port_file.is_file():
            time.sleep(0.2)
        assert port_file.is_file(), "server did not write the port file"
        port = int(port_file.read_text(encoding="utf-8").strip())
        assert port > 0
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as resp:
            assert resp.status == 200
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
