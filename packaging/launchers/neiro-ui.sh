#!/usr/bin/env bash
# One-click Neiro interface launcher (macOS / Linux).
# First run creates a local environment and installs Neiro with the neural
# model stack (a few minutes, one time). Requires Python 3.10–3.12.
set -e
cd "$(dirname "$0")"

VENV_PY=".venv/bin/python"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found. Install Python 3.11 from https://python.org and re-run."
  exit 1
fi

if [ ! -x "$VENV_PY" ]; then
  echo "First-time setup: creating environment..."
  python3 -m venv .venv
  "$VENV_PY" -m pip install --upgrade pip
fi

if ! "$VENV_PY" -c "import neiro" 2>/dev/null; then
  # Prefer an absolute path so pip extras resolve unambiguously.
  WHEEL="$(ls -1 "$PWD"/wheels/neiro-*.whl 2>/dev/null | head -n1 || true)"
  if [ -z "$WHEEL" ]; then
    echo "No Neiro wheel found in wheels/."
    exit 1
  fi
  echo "Installing Neiro from bundled wheel..."
  "$VENV_PY" -m pip install "${WHEEL}[all]"
fi

echo "Starting Neiro interface (a browser tab will open)..."
exec "$VENV_PY" -m neiro.cli ui
