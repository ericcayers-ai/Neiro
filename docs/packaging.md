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
uv pip install pyinstaller               # once, dev environment
python scripts/build_sidecar.py --install # -> src-tauri/resources/engine/ (clean)
```

Measured 2026-10-20: build completed in ~39 s; `neiro.exe` is ~11 MB plus its
runtime folder, reports `neiro 1.2.1`, and serves `/api/health` on an ephemeral
port (`--port 0 --port-file`). This was verified with the frozen binary directly,
not through a GUI.

`src-tauri/src/lib.rs` now prefers a bundled engine, looking next to the app binary
at `neiro-engine(.exe)`, `engine/…`, `resources/engine/…`, `resources/…`; it falls
back to system Python for development. A release copies the built `neiro` folder
to `src-tauri/resources/engine/` and renames the executable to `neiro-engine`.

The release bundle is wired: `bundle.resources` includes `resources/engine/`
(a tracked README explains the copy step), and

```powershell
npx --prefix frontend tauri build --no-bundle
```

completed in **2m32s** and produced `src-tauri/target/release/neiro.exe`
(optimized). That validates the config, the dynamic-port shell, and the resource
path; the engine binary itself is per-platform and not committed.

With the engine copied into `resources/engine/`, a full `tauri build` produced:

| Artifact | Size |
|---|---:|
| `Neiro_1.2.1_x64_en-US.msi` | 56.0 MB |
| `Neiro_1.2.1_x64-setup.exe` (NSIS) | 38.3 MB |

An administrative MSI extraction (`msiexec /a … TARGETDIR=…`) confirmed the payload
layout: `PFiles\Neiro\neiro.exe` plus `resources\engine\neiro-engine.exe`
(10.5 MB) and its `_internal` folder (numpy etc.). That is the path `lib.rs` probes,
so the installed app starts the bundled engine instead of system Python.

Launch verification (simulated fresh machine):

1. MSI extracted with `msiexec /a` (no install, no system changes).
2. PATH reduced to `%SystemRoot%\system32;%SystemRoot%` so no Python is reachable.
3. `PFiles\Neiro\neiro.exe` launched; within 15 s it spawned
   `resources\engine\neiro-engine.exe` and the main window title was **Neiro**.
4. App and engine processes were terminated afterwards.

That proves the shell prefers the bundled engine and does not need system Python
for this layout. It is not a clean-VM test: WebView2 was already installed.

## Updater (pipeline verified)

The Tauri updater plugin is configured (`plugins.updater` with a minisign public
key and the GitHub Releases `latest.json` endpoint). The private key lives at
`~/.neiro-updater/neiro.key` (never committed; README there explains usage); the
public key is committed in `tauri.conf.json`.

Normal builds stay key-free (`createUpdaterArtifacts: false`). Release builds:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.neiro-updater\neiro.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content -Raw "$HOME\.neiro-updater\password.txt"
npx --prefix frontend tauri build --config src-tauri/tauri.release.conf.json
python scripts/updater_manifest.py --version 1.2.1 ^
  --base-url https://github.com/ericcayers-ai/Neiro/releases/download/v1.2.1 ^
  --out latest.json
```

Measured 2026-10-21: the build produced `Neiro_1.2.1_x64-setup.exe.sig` and
`Neiro_1.2.1_x64_en-US.msi.sig` (416 B each), and `updater_manifest.py` produced a
`latest.json` with that signature and the release URL. A Rust test
(`cargo test --lib`, part of gate C23) decodes the committed public key and the
base64-wrapped `.sig`, then verifies the signature against the installer — so the
key/signature/artifact chain is proven, not just present.

About → **Check for updates** uses the updater plugin when running in the desktop
shell (check, progress, download/install, relaunch) and keeps the GitHub Releases
check in a normal browser.

Runtime verification (`npm run test:desktop-updater`): the release exe is launched
with WebView2 remote debugging, Playwright connects over CDP, and About → Check for
updates reports **“Updater check failed (Could not fetch a valid release JSON from
the remote)”** — i.e. the plugin was reached through Tauri IPC and the failure is
surfaced. A browser fallback would have said “Could not reach GitHub” and fails the
check.

Tauri rejects updater endpoints that are not HTTPS (`the configured updater
endpoint must use a secure protocol like https`), so a local `http://` manifest
cannot be used to exercise the success path. The check/error path is verified;
offering an actual update requires a real HTTPS release (or a trusted TLS dev
server).

Two shell details this exposed and fixed:

- the window is now created **directly on the engine origin** (`WebviewUrl::External`)
  with a `remote.urls = ["http://127.0.0.1:*"]` capability; navigating an
  `about:blank` window to a remote URL does not expose the IPC globals;
- a stale `target/release/resources/engine` from an earlier build can ship an old
  UI, so `scripts/build_sidecar.py --install` now cleans and re-stages it and the
  release notes say to remove `target/release/resources` before building.

Still missing: hosting/publishing the release assets, a publicly trusted signing
certificate (Authenticode), and a clean-VM update test.

## Signing (pipeline verified with a dev certificate)

`scripts/sign_windows.ps1` signs artifacts with Authenticode using a PFX supplied
through `NEIRO_SIGN_PFX` / `NEIRO_SIGN_PASSWORD` (never committed), falls back to
unsigned-timestamp signing if the timestamp server is unreachable, and reports the
signature status. `signtool.exe` is discovered from PATH or the Windows SDK.

Measured 2026-10-21 with a temporary self-signed code-signing certificate
(`CN=Neiro Dev Signing`, removed afterwards):

| Artifact | Signed | Timestamped | Authenticode status |
|---|---|---|---|
| `Neiro_1.2.1_x64_en-US.msi` (56.0 MB) | yes | yes | `UnknownError` (untrusted root) |
| `Neiro_1.2.1_x64-setup.exe` (38.3 MB) | yes | yes | `UnknownError` (untrusted root) |

`signtool verify /pa` exits 1 with “a certificate chain processed, but terminated
in a root certificate which is not trusted” — exactly what a self-signed test cert
should produce. The signature and timestamp are present; only trust is missing.

A release needs a **publicly trusted OV/EV code-signing certificate** (then rerun
the script and `signtool verify /pa`), SmartScreen reputation, updater keys and an
update endpoint, and a clean-VM install/uninstall test.

Still missing (owner-gated):

- trusted certificate + notarisation/SmartScreen, updater key/endpoint,
- a clean-VM install with no Python, no WebView2 and no network,
- uninstall verification.

Do not describe the desktop build as standalone until those pass.
