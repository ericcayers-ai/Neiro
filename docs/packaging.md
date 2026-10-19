# Packaging and launch contract

The current Tauri shell is **not** a standalone app: it spawns system Python and
expects a fixed port (8377). This page records the contract the shell should use
and what is still missing.

## Dynamic port (implemented end to end)

`neiro ui --port 0 --port-file <path>` binds an OS-chosen loopback port, serves the
API and UI there, writes the real port to `<path>`, and prints the actual URL.
Covered by `tests/test_dynamic_port.py`.

The Tauri shell (`src-tauri/src/lib.rs`) now:

1. reserves a free loopback port with `TcpListener::bind(("127.0.0.1", 0))`,
2. spawns `python -m neiro.cli ui --port <port>` and reuses that port across
   restarts,
3. probes `/api/health` before declaring the engine ready,
4. navigates the main window to `http://127.0.0.1:<port>/` after it is ready
   (the window starts on `about:blank`),
5. reports the live URL from `engine_status`.

The window CSP allows `http://127.0.0.1:*` / `ws://127.0.0.1:*` instead of a single
fixed port. `cargo fmt --check`, `cargo clippy -- -D warnings` and `cargo check`
pass. **Runtime launch is not verified here**: a GUI build/launch and a
fresh-machine test are still owner steps.

## Sidecar (build verified)

`packaging/neiro.spec` builds a model-free PyInstaller folder; `scripts/build_sidecar.py`
wraps it:

```powershell
uv pip install pyinstaller          # once, dev environment
python scripts/build_sidecar.py    # -> dist/neiro/neiro.exe (+ _internal/)
```

Measured 2026-10-20: build completed in ~39 s; `neiro.exe` is ~11 MB plus its
runtime folder, reports `neiro 1.2.1`, and serves `/api/health` on an ephemeral
port (`--port 0 --port-file`). This was verified with the frozen binary directly,
not through a GUI.

`src-tauri/src/lib.rs` now prefers a bundled engine, looking next to the app binary
at `neiro-engine(.exe)`, `engine/…`, `resources/engine/…`, `resources/…`; it falls
back to system Python for development. A release copies the built `neiro` folder
to `src-tauri/resources/engine/` and renames the executable to `neiro-engine`.

Still missing (owner-gated):

- a `bundle.resources` entry and a full `tauri build` that ships the folder,
- signing certificates + updater keys (`TAURI_SIGNING_PRIVATE_KEY`),
- a fresh-machine test with no Python and no network,
- uninstall verification.

Do not describe the desktop build as standalone until those pass.
