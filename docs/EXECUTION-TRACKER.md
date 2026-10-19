# Execution tracker — Neiro

**Purpose:** the durable answer to *what is done, running, blocked, owner-needed, and
must not be assumed*. Updated whenever a phase changes state. The gate
(`python scripts/verify_goal.py`) is the authority; this file may explain a FAIL but
may not overrule it.

**Current state (2026-10-20, session start):** implementation pass opened from
`HANDOFF.md` + `docs/AUDIT.md`. Phase 0 in progress. Baseline at `c3cc5c0`, tag
`v1.2.1`, dirty worktree preserved.

## Phase status

| Phase | State | Evidence |
|---|---|---|
| 0. Truth & safety | in progress | gate rows C1–C9, C15, C17 |
| 1. Shared real-time player | not started | gate rows C10, C11 |
| 2. Practice & library | not started | gate row C12 |
| 3. Analysis | not started | gate row C13 |
| 4. Optional companion | not started | gate row C14 |
| 5. i18n / a11y / packaging | not started | gate row C18 |
| 6. Release evidence | not started | audit refresh |

## Confirmed vs not claimed

**Confirmed by the opening audit (2026-10-20):** live engine `ok` at 1.2.1; 70 models
registered / 16 ready; 219 passed + 1 skipped with a short basetemp; `ruff check`
green; `ruff format` red on two doc fences; frontend `tsc`/`vite build` green; the
`pitch_correct` job works only because of the uncommitted worktree fix; auto-enhance
returns `done` with an empty chain; session notes round-trip as a character list;
`verify_models.py` reports 70/70 absent because it calls `neiro` on PATH.

**Not verified, and not claimed:** live Transpose execution; any browser-site capture;
WebGPU stems; model downloads; listening quality; packaged installer; macOS/Linux;
screen-reader walkthrough; live-site addon e2e.

## Owner decisions still open (from HANDOFF §13)

1. Scope: local-first parity vs literal commercial parity — default applied:
   **local-first; accounts/cloud/subscription/share/3-slot limits are N/A.**
2. DSP licence: **Signalsmith Stretch not vendored in this pass; DSP is a clean-room
   implementation in the worklet**, so no third-party DSP licence is triggered. A
   future WASM build must verify MIT/formant before bundling.
3. Addon: **hybrid standalone RT + optional paired Neiro Q** applied.
4. Packaging: **bundled sidecar + dynamic port + signing** — code-safe parts only in
   this pass; a signed installer needs the owner's certificate.
5. Dirty work: **preserve the rest; commit the pitch-correct fix with a test.**

## Owner-only operations

- Live-site addon e2e (requires a real browser profile and site logins).
- Code signing / notarisation (requires certificates).
- Model downloads > 1 GB (disk preflight required; owner consent).
- Publishing/pushing (out of scope for this pass).
