# Release candidate after the QA sweep — 2026-10-23

Fresh sidecar + signed installers from the tree that includes every QA fix
(session reload, focus traps, URL fallback, cancel auth, tray/track layout, etc.).

## Artifacts

| Artifact | Size |
|---|---:|
| `Neiro_1.2.1_x64_en-US.msi` | 58.2 MB |
| `Neiro_1.2.1_x64-setup.exe` (NSIS) | 39.9 MB |
| updater `.sig` for both | present |

- `cargo test --lib` verifies the NSIS signature against the committed key.
- `msiexec /a` extraction launched with **PATH reduced to system dirs (no Python)**:
  spawned `neiro-engine.exe` and opened the **Neiro** window.

## Suite (all exit 0)

Gate 23/23 (290 Python tests collected, 3 skipped; 53 player; 17 vitest; addon
49/49); updater signature test; desktop smoke (9 modules); desktop workflow;
updater runtime IPC; packaged axe/overflow; full 18-step flows; companion e2e;
Chromium worklets; backend CLI; live API security probe; addon validator.

Not covered (owner-run): trusted Authenticode cert and publishing, clean-VM
install/update/uninstall, listening quality, live streaming capture, neural model
weights, non-English catalogues/RTL.
