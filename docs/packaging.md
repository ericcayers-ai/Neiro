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

## Sidecar

`packaging/neiro.spec` already builds a model-free PyInstaller folder, but Tauri's
`tauri.conf.json` has no `externalBin`/`resources` entry and no updater/signing
configuration. A release needs:

- the frozen engine as a Tauri sidecar/resource,
- a model-free default build (models are opt-in downloads),
- signing certificates + updater keys (`TAURI_SIGNING_PRIVATE_KEY`),
- a fresh-machine test with no system Python.

None of that release work was performed here; the audit and work list keep it
open. Do not describe the desktop build as standalone until a fresh machine
without Python passes the launch test.
