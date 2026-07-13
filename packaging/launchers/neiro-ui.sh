#!/usr/bin/env bash
# One-click Neiro interface launcher (macOS / Linux).
# First run creates a local environment and installs Neiro with the neural
# model stack (a few minutes, one time). Requires Python 3.10–3.12.
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found. Install Python 3.11 from https://python.org and re-run."
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "First-time setup: creating environment and installing Neiro..."
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python -m pip install --upgrade pip
  python -m pip install "$(ls wheels/neiro-*.whl | head -n1)[all]"
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

echo "Starting Neiro interface (a browser tab will open)..."
python -m neiro.cli ui
