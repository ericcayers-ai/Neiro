This folder is bundled into the desktop app as `resources/engine/`.

A release build copies the model-free sidecar here:

    python scripts/build_sidecar.py --dist dist
    copy dist\neiro\* src-tauri\resources\engine\
    rename src-tauri\resources\engine\neiro.exe neiro-engine.exe

`src-tauri/src/lib.rs` looks for `resources/engine/neiro-engine(.exe)` (and a few
sibling paths) before falling back to system Python. The binary is intentionally
not committed: build it per platform, sign it, and keep it out of git.
