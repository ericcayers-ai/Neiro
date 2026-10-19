# Packaging and launch contract

The current Tauri shell is **not** a standalone app: it spawns system Python and
expects a fixed port (8377). This page records the contract the shell should use
and what is still missing.

## Dynamic port (implemented, Python side)

`neiro ui --port 0 --port-file <path>` binds an OS-chosen loopback port, serves the
API and UI there, and writes the real port number to `<path>` after binding. The
port file is created atomically (write) and the printed URL uses the actual port,
not 0. Covered by `tests/test_dynamic_port.py`.

The Tauri side should:

1. choose a free port (or pass `--port 0`),
2. spawn the bundled engine with the same `--port-file`,
3. poll the file + `/api/health`, then load `http://127.0.0.1:<port>/`,
4. remove the file on exit and restart the engine if health fails.

Steps 1–4 in Rust are **not implemented or compiled** in this pass; the Python
contract exists so the shell change is small and testable.

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
