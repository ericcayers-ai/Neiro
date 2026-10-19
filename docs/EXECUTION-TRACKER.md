# Execution tracker — Neiro

**Purpose:** the durable answer to *what is done, running, blocked, owner-needed, and
must not be assumed*. Updated whenever a phase changes state. The gate
(`python scripts/verify_goal.py --full`) is the authority; this file may explain a
FAIL but may not overrule it.

**Current state (2026-10-20, implementation pass):** `GATE PASS — 18/18 criteria`.
Python suite 272 passed / 1 skipped (2 deselected); player tests 36 passed; addon validator 46/46;
frontend tsc + build pass; 5 vitest SSR tests. Commit `cf6c35b` contains the implementation (including
the preserved `pitch_correct` fix and its regression test). Receipts:
`docs/evidence/{implementation,security,player-latency}-2026-10-20.md`.

## Phase status

| Phase | State | Evidence |
|---|---|---|
| 0. Truth & safety | **done** | gate C1–C9, C15, C17, C19, C20; security/disk receipts |
| 1. Shared real-time player | **done** (Studio transport partial) | gate C10–C11; latency receipt |
| 2. Practice & library | **partial** (marker promotion, model-size preflight open; MIDI learn, resume/reset, disk-aware cache done) | gate C12; `docs/library.md` |
| 3. Analysis | **partial** (heuristic only; ONNX adapters absent) | gate C13; `tests/test_analysis_timeline.py` |
| 4. Optional companion | **source done**, live e2e owner-run | gate C14; `docs/COMPANION.md` |
| 5. i18n / a11y / packaging | **partial** (static a11y clean; dynamic port done; sidecar/signing open) | gate C18, C21; `docs/accessibility.md`, `docs/packaging.md` |
| 6. Release evidence | **partial** (Rust build/signing open) | receipts + addenda |

## Confirmed vs not claimed

**Confirmed by this pass:** gate 18/18; 262 tests; pitch-correct progress contract;
auto-enhance no-op; scalar notes; security probes return 401/403/413/415 as designed;
player DSP direction/null/finite tests; measured 23.2 ms algorithmic latency and
5.23× worst render factor; library persistence across reopen; analysis confidence /
no-result; addon manifest + no remote code + worklet tests.

**Not verified, and not claimed:** browser control-to-audio latency; live-site
capture (YouTube/Spotify/SoundCloud); listening/ABX quality; tab-capture revocation;
Rust build/clippy; signed installer/updater; screen-reader/WCAG audit; any neural
chord/beat model; Spotify EME capture.

## Owner decisions (recorded 2026-10-20)

1. Scope: **local-first**; accounts/cloud/subscription/share/3-slot limits are N/A.
2. DSP licence: **clean-room implementation in the worklet**, no third-party DSP
   bundled. A future WASM build must verify MIT/formant before vendoring.
3. Addon: **hybrid** standalone RT + optional paired Neiro queued processing.
4. Packaging: bundled sidecar + dynamic port + signing remains the direction; not
   implemented in this pass.
5. Dirty work: the `pitch_correct` fix is committed with a regression test; the rest
   of the owner's worktree changes were preserved untouched.

## Owner-only operations

- Live-site addon e2e (real browser profile + logins).
- Listening panel / ABX quality judgement.
- Code signing and notarisation (certificates).
- Model downloads > 1 GB (disk preflight + consent).
- Push/publish (not done in this pass).
- Rust `cargo check`/clippy/full Tauri build (target cache and disk).
