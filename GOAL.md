# Neiro goal and acceptance criteria

**Goal (one line):** make Neiro's claims true, give it one shared real-time player,
keep the Python engine as the queued quality path, and port every Transpose 6.5.4
*capability* clean-room — without accounts, cloud, subscription, share links, or
copied proprietary code/assets/locales/`rb.wasm`.

- Owner: ericc
- Repo: `C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant`
- Baseline: `main` @ `c3cc5c0`, tag `v1.2.1`, 2026-10-20
- Execution register: `docs/EXECUTION-TRACKER.md`
- Live work list: `tasks/WORKLIST.md`
- Evidence ledger: `docs/AUDIT.md`; operating brief: `HANDOFF.md`
- Gate: `python scripts/verify_goal.py` (add `--full` to include the frontend build)

This file is the **single criteria authority**. Every row below has one mechanical
check in the gate; the gate asserts the row set matches the check set, so a new
criterion without a check fails the gate. `[x]` means the gate printed PASS with a
receipt, never "intent".

## Completion contract

- **Outcome:** a user can load a song, play it with real-time transpose / fine pitch /
  speed / formant / EQ / vocal reducer, loop A–B, count in, use markers and practice
  clips, keep notes in a library that survives restart, read honest chord/beat data,
  and queue high-quality renders; the optional MV3 companion can capture a tab and
  drive the same player; all claims are labelled by actual method.
- **Verification:** the gate below, plus `docs/evidence/*.md` receipts with commands
  and decisive output. Listening/latency claims require a measured receipt; browser
  e2e on live sites is explicitly owner-run and stays unverified here.
- **Constraints:** local-first; no telemetry; no remote code; no model download
  without consent and a disk preflight; the dirty owner worktree is preserved.
- **Boundaries:** do not edit Neutral or `learning-studio`; do not copy Transpose
  code, UI, locales, images, CDN artefacts, or `rb.wasm` (Tune73 commercial).
- **Stop when:** every criterion is PASS in the gate, or an owner-only blocker is
  recorded in `docs/EXECUTION-TRACKER.md` with the exact operation the owner must run.

## Criteria

| ID | Criterion | Accept: evidence |
|---|---|---|
| C1 | Dirty work preserved and the pitch-correct fix committed with a regression test | `git log` contains the fix commit; `tests/test_pitch_correct_report.py` fails on the old `progress("…", fraction=)` shape and passes now; `git diff` no longer hides the fix |
| C2 | Python suite green | `pytest -q -m "not slow" --basetemp C:\np` exits 0 with ≥ 230 tests and new contract/security tests included |
| C3 | Lint and format green | `ruff check .` and `ruff format --check .` both exit 0 |
| C4 | Frontend type-check and production build green | `tsc -p tsconfig.app.json --noEmit` and `vite build` exit 0 (gate `--full`) |
| C5 | Auto-enhance never reports done without an artefact | job result carries `noop: true` + `reason` when the chain is empty; API/UI test proves it |
| C6 | Session notes are a scalar with a 5 000-character cap | save→open round-trip preserves the string; over-cap is rejected; test proves both |
| C7 | `verify_models.py` is interpreter-safe | it invokes `sys.executable -m neiro.cli`, not `neiro` on PATH; parser test passes |
| C8 | Browser-CSRF surface closed | POST without token → 401, `Origin: https://evil.example` → 403, `text/plain` JSON → 415, oversized body → 413, upload over cap → 413, plugin grant / tool install without `confirm` → 400 |
| C9 | CORS is an allowlist, never `*` | OPTIONS returns 204 with an allowlisted origin only; no wildcard header in source; test proves |
| C10 | One shared real-time player exists and is measured | `frontend/src/player/*` modules + worklet; Node unit tests pass; a `docs/evidence/player-latency-*.md` receipt records measured control latency and null/click results |
| C11 | Practice is honest and functional | count-in gates playback; wait mode pauses/resumes at note boundaries; A–B loop loops the selection; speed is real-time; provenance labels show the actual method |
| C12 | Library persists per-song data | SQLite schema + API for songs/notes/markers/clips/scenes/playlists/versions; restart round-trip test; 5 000-char notes; no cloud |
| C13 | Analysis is honest and visible | chord/beat timeline with confidence and `no reliable result`; heuristic labelled heuristic; Analysis UI renders the lanes |
| C14 | Optional MV3 companion exists | `addon/` manifest + side panel + offscreen capture + site adapter interface + pairing; static validator exits 0; live-site e2e is owner-run and stated unverified |
| C15 | Docs match code | README version/Python range, `docs/session.md`, `SECURITY.md`, `docs/ui.md` corrected; traceability banner present; no stale "pitch-preserving/Rubber Band/verified" claim in current surfaces |
| C16 | Licence boundary enforced | no `rb.wasm`/Tune73 artefact in the tree; third-party notices list every new dependency; QR check in gate |
| C17 | Queued processing is managed | time-stretch/pitch-shift run as jobs with progress, cancel and a `(file_id, op, params)` cache; no synchronous whole-file wait in the practice path |
| C18 | i18n and accessibility baseline | all new player/library strings go through one catalogue module; axe-style checks documented; keyboard-only player path tested |

## Status rule

The gate is the authority. `docs/EXECUTION-TRACKER.md` may explain a FAIL; it may not
overrule it. A criterion marked owner-blocked must name the exact human operation.
