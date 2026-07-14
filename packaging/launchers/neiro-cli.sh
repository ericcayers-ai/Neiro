#!/usr/bin/env bash
# One-click Neiro command line (macOS / Linux). Opens a shell with `neiro` ready.
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
  if [ ! -f "$PWD/install_neiro.py" ]; then
    echo "Missing install_neiro.py next to this launcher."
    exit 1
  fi
  echo "Installing Neiro from bundled wheel (torch first, with retries)..."
  "$VENV_PY" "$PWD/install_neiro.py"
fi

cat <<'EOF'

Neiro is ready. Try:
  neiro analyze yoursong.flac
  neiro separate yoursong.flac --preset vocals-best
  neiro transcribe yoursong.wav --out song.mid
  neiro models

EOF
# shellcheck disable=SC1091
source .venv/bin/activate
exec "${SHELL:-bash}"
