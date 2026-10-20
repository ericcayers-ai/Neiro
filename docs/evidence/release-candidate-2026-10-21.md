# Release candidate build — 2026-10-21

Fresh end-to-end packaging run on the current tree (after updater/IPC/EQ work).

## Build

```powershell
python scripts/build_sidecar.py --install      # clean, README-preserving staging
Remove-Item -Recurse -Force src-tauri/target/release/resources
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.neiro-updater\neiro.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content -Raw "$HOME\.neiro-updater\password.txt"
npx --prefix frontend tauri build --config src-tauri/tauri.release.conf.json
```

## Artifacts

| Artifact | Size |
|---|---:|
| `Neiro_1.2.1_x64_en-US.msi` | 58.1 MB |
| `Neiro_1.2.1_x64-setup.exe` (NSIS) | 39.8 MB |
| both `.sig` updater signatures | 416 B each |

`updater_manifest.py` produced a valid `latest.json` with the NSIS signature and
release URL.

## Payload and launch

- `msiexec /a` extraction contains `PFiles\Neiro\neiro.exe`,
  `resources\engine\neiro-engine.exe` (10.5 MB) and `_internal`.
- Launched the extracted app with **PATH reduced to system dirs (no Python)**:
  it spawned `resources\engine\neiro-engine.exe`, created the WebView2 window
  titled **Neiro**, and was terminated after 15 s.

This validates the current code through the full release path. Not covered: a
publicly trusted Authenticode certificate, publishing the assets, a clean-VM
install/update, uninstall, or a real listening/quality pass.
