#!/usr/bin/env bash
# One-click Neiro command line (macOS / Linux). Opens a shell with `neiro` ready.
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

cat <<'EOF'

Neiro is ready. Try:
  neiro analyze yoursong.flac
  neiro separate yoursong.flac --preset vocals-best
  neiro transcribe yoursong.wav --out song.mid
  neiro models

EOF
exec "${SHELL:-bash}"
