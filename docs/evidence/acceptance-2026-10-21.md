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
| Desktop workflow | `cd frontend; npm run test:desktop-workflow` | **PASS** (import → analysis → player, 0 errors) |
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

## Re-run after rounds 60–61

Re-ran every browser/desktop check on the tree with the MIDI catalogue and Studio
EQ changes:

| Check | Exit |
|---|---:|
| Desktop smoke (9 modules) | 0 |
| Desktop workflow (import → analysis → player) | 0 |
| Desktop updater runtime (Tauri IPC) | 0 |
| Companion e2e (dynamic port) | 0 |
| Chromium worklets (speed/+12/+7, shifter) | 0 |

Gate remained **23/23** on its last full run. No regressions from the UI/EQ work.

## Final suite after RTL/CSP/CI work (2026-10-21)

One pass over the gate and every browser/desktop check on the current tree:

| Check | Exit |
|---|---:|
| Gate (281 Python, 53 player, 17 vitest, 49 addon) | 0 |
| Desktop smoke (9 modules) | 0 |
| Desktop workflow (import → analysis → player) | 0 |
| Desktop updater runtime (Tauri IPC) | 0 |
| Companion e2e (dynamic port) | 0 |
| Chromium worklets (speed/+12/+7, shifter) | 0 |

No regressions from the RTL plumbing, CSP/security headers or CI/release edits.
The unproven list remains unchanged: listening quality, device latency, trusted
signing/hosting, clean-VM install/update, live streaming sites, full RTL/plurals,
neural models.

## Round 79 final verification

Re-ran the full set on the final tree (281 Python, 53 player, 17 vitest, 49 addon):

| Check | Exit |
|---|---:|
| Gate | 0 |
| Desktop smoke (9 modules) | 0 |
| Desktop workflow (import → analysis → player) | 0 |
| Desktop updater runtime (Tauri IPC) | 0 |
| Companion e2e (dynamic port) | 0 |
| Chromium worklets | 0 |

Every automated check that exists in this repo passes. The owner-gated list is
unchanged: trusted cert/hosting, clean-VM install/update, listening quality,
per-stem phase-vocoder engine, neural models, non-English/RTL CSS, live-site capture.

## QA suite after UI fixes (2026-10-22)

Rebuilt sidecar + desktop, then ran 14 checks — all exit 0:

| Check | Result |
|---|---|
| Gate 23/23 | PASS |
| Desktop smoke (9 modules) | PASS |
| Desktop workflow (import → analysis → player) | PASS |
| Updater runtime (Tauri IPC) | PASS |
| Desktop axe/overflow (packaged) | PASS (0 violations) |
| Engine axe/overflow — light theme | PASS |
| Engine axe/overflow — 1024×700 | PASS |
| Full user flows (19 steps) | PASS |
| Library resume + open-player preference | PASS |
| Separate queue → packs | PASS |
| Companion e2e | PASS |
| Chromium worklets | PASS |
| Backend CLI (analyze/transcribe/enhance/separate) | PASS |
| Addon validator 49/49 | PASS |

Defects fixed during the sweep are recorded in `qa-sweep-2026-10-22.md`.

## Round-88 regression (QA additions)

Gate plus ten focused checks — per-module axe, full flows, clip context menu,
settings persistence, session validation, packs, resume preference, companion e2e,
worklets and addon validator — all exit 0 after the latest test additions.

