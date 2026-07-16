#!/usr/bin/env bash
# Install the Neiro DAW injector (VST2) into a standard user plug-in path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT/plugins/neiro-vst"
cd "$PLUGIN_DIR"
cargo +stable build --release

LIB=""
if [[ -f target/release/libneiro_daw.dylib ]]; then
  LIB=target/release/libneiro_daw.dylib
elif [[ -f target/release/libneiro_daw.so ]]; then
  LIB=target/release/libneiro_daw.so
elif [[ -f target/release/neiro_daw.dll ]]; then
  LIB=target/release/neiro_daw.dll
else
  echo "Built library not found under target/release/" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    DEST="${HOME}/Library/Audio/Plug-Ins/VST/Neiro DAW Bridge.vst"
    mkdir -p "$DEST/Contents/MacOS"
    cp "$LIB" "$DEST/Contents/MacOS/Neiro DAW Bridge"
    cat > "$DEST/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Neiro DAW Bridge</string>
  <key>CFBundleIdentifier</key><string>ai.neiro.daw-bridge</string>
  <key>CFBundleName</key><string>Neiro DAW Bridge</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
</dict></plist>
PLIST
    echo "Installed VST2 bundle → $DEST"
    ;;
  Linux)
    DEST="${HOME}/.vst/neiro_daw.so"
    mkdir -p "$(dirname "$DEST")"
    cp "$LIB" "$DEST"
    echo "Installed VST2 → $DEST"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    DEST="${COMMONPROGRAMFILES:-/c/Program Files/Common Files}/VST2/neiro_daw.dll"
    mkdir -p "$(dirname "$DEST")"
    cp "$LIB" "$DEST"
    echo "Installed VST2 → $DEST"
    ;;
  *)
    echo "Unsupported OS; copy $LIB into your DAW's VST2 folder manually." >&2
    exit 1
    ;;
esac

echo
echo "Usage:"
echo "  1. Start Neiro (neiro ui  or  the desktop app)"
echo "  2. Insert 'Neiro DAW Bridge' on any track"
echo "  3. Open the plugin editor → the single Neiro window focuses Learn"
echo "  Multiple inserts share that one window."
