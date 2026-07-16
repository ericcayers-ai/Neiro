#!/usr/bin/env bash
# Install the Neiro DAW injector into standard user plug-in paths.
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

CLAP_DIR="$ROOT/plugins/neiro-clap"
cd "$CLAP_DIR"
cargo +stable build --release

CLAP_LIB=""
if [[ -f target/release/libneiro_clap.dylib ]]; then
  CLAP_LIB=target/release/libneiro_clap.dylib
elif [[ -f target/release/libneiro_clap.so ]]; then
  CLAP_LIB=target/release/libneiro_clap.so
elif [[ -f target/release/neiro_clap.dll ]]; then
  CLAP_LIB=target/release/neiro_clap.dll
else
  echo "Built CLAP/VST3 library not found under plugins/neiro-clap/target/release/" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    CLAP_DEST="${HOME}/Library/Audio/Plug-Ins/CLAP/Neiro DAW Bridge.clap"
    mkdir -p "$CLAP_DEST/Contents/MacOS"
    cp "$CLAP_LIB" "$CLAP_DEST/Contents/MacOS/Neiro DAW Bridge"
    VST3_DEST="${HOME}/Library/Audio/Plug-Ins/VST3/Neiro DAW Bridge.vst3"
    mkdir -p "$VST3_DEST/Contents/MacOS"
    cp "$CLAP_LIB" "$VST3_DEST/Contents/MacOS/Neiro DAW Bridge"
    echo "Installed CLAP preview → $CLAP_DEST"
    echo "Installed VST3 preview → $VST3_DEST"
    ;;
  Linux)
    CLAP_DEST="${HOME}/.clap/neiro_clap.clap"
    mkdir -p "$(dirname "$CLAP_DEST")"
    cp "$CLAP_LIB" "$CLAP_DEST"
    VST3_DEST="${HOME}/.vst3/Neiro DAW Bridge.vst3/Contents/x86_64-linux"
    mkdir -p "$VST3_DEST"
    cp "$CLAP_LIB" "$VST3_DEST/Neiro DAW Bridge.so"
    echo "Installed CLAP preview → $CLAP_DEST"
    echo "Installed VST3 preview → $VST3_DEST"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    CLAP_DEST="${COMMONPROGRAMFILES:-/c/Program Files/Common Files}/CLAP/neiro_clap.clap"
    mkdir -p "$(dirname "$CLAP_DEST")"
    cp "$CLAP_LIB" "$CLAP_DEST"
    VST3_DEST="${COMMONPROGRAMFILES:-/c/Program Files/Common Files}/VST3/Neiro DAW Bridge.vst3/Contents/x86_64-win"
    mkdir -p "$VST3_DEST"
    cp "$CLAP_LIB" "$VST3_DEST/Neiro DAW Bridge.vst3"
    echo "Installed CLAP preview → $CLAP_DEST"
    echo "Installed VST3 preview → $VST3_DEST"
    ;;
  *)
    echo "Unsupported OS; copy $CLAP_LIB into your DAW's CLAP/VST3 folder manually." >&2
    exit 1
    ;;
esac

echo
echo "Usage:"
echo "  1. Start Neiro (neiro ui  or  the desktop app)"
echo "  2. Insert 'Neiro DAW Bridge' on any track"
echo "  3. Open the plugin editor → the single Neiro window focuses Learn"
echo "  Multiple inserts share that one window."
echo "  CLAP/VST3 installs are preview bridge stubs; use VST2 for production injection."
