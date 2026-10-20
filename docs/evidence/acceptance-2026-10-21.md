# Acceptance run — 2026-10-21

One pass over every automated check that exists, on the tree at `5487c57` plus the
uncommitted evidence of this run.

| Check | Command | Result |
|---|---|---|
| Gate (C1–C23) | `python scripts/verify_goal.py --full` | **23/23 PASS** |
| Python suite | included in gate | **280 passed / 3 skipped** |
| Player Node tests | gate C10 | **49 passed** |
| Vitest (player SSR, axe, modules) | gate C22 | **17 passed** |
| Chromium worklets | `cd frontend; npm run test:browser` | **PASS** |
| Extension e2e | `cd frontend; npm run test:extension` | **PASS** |
| Addon validator | `node addon/scripts/validate.mjs` | **47/47** |
| Companion worklet tests | `node --test addon/tests/capture.test.mjs` | **6 passed** |
| Updater manifest | `python scripts/updater_manifest.py …` | **PASS** |
| Desktop updater runtime | `cd frontend; npm run test:desktop-updater` | **PASS** (Tauri IPC path; no-release error surfaced) |
| Desktop shell smoke | `cd frontend; npm run test:desktop-smoke` | **PASS** (all 9 modules, 0 page errors) |
| Desktop updater availability | `cd frontend; npm run test:updater-available` (dev-flag build) | **PASS** (“Update available: 1.2.2.”) |

## Worklet numbers (Chromium OfflineAudioContext)

- stem shifter +12 st: 880 Hz dominates 440 Hz ~16.7×;
- player 2× speed: 440 Hz dominates 880 Hz ~22× (pitch preserved);
- player +12 st: 880 Hz dominates 440 Hz ~26×;
- player +7 st (fractional ratio): target 659.3 Hz ~10×.

## Extension e2e

Unpacked MV3 extension, dynamic engine port, Engine URL saved, pairing code
exchanged, health checked, WAV uploaded and analysed (“A minor”). Tab capture is
explicitly **not** automated (Chrome permission dialog).

## Scope

This run proves the automated and browser-level checks listed above. It does not
prove listening quality, device latency, trusted code signing, a clean-VM
install/update, live streaming sites, full localization, or a trained chord/beat
model. Those remain the owner-gated items in the worklist.
