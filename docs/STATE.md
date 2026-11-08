# music-assistant — state

Updated 2026-11-08 (public-release audit). Keep under 60 lines.

## Verified at update time

- branch `main`, tree clean after the release-audit commits.
- stack: python (`pyproject`, `.venv`), node/React/Vite (`frontend`), Tauri (`src-tauri`).
- Python gate: `.venv\Scripts\python.exe -m pytest -q -m "not slow" --basetemp C:\np`
  → **299 passed, 3 skipped** (the `--basetemp` is mandatory on Windows; see `HANDOFF.md` §14).
- Frontend gate: `cd frontend && npx --no-install vitest run` → **153 tests passed**;
  `tsc -b` + `vite build` pass; `npx oxlint` clean.
- Goal gate: `python scripts/verify_goal.py --full` → **22/23 locally**, C23 (Rust) only
  because the disk guard blocks the build here; **CI's Rust job is green** on the
  published commit, as are all 14 CI jobs (Python 3.10-3.12 × Windows/Ubuntu/macOS,
  frontend, addon, packaging). Receipts:
  `docs/evidence/security-release-audit-2026-11-08.md`.

## Public-release audit (2026-11-08)

- `cybersafe_scan.py` → 0 findings; secret/private-data scan over the tree **and full
  history** → 0 tree hits.
- Licence audit of 24 installed Python distributions, 93 frontend packages and every
  model manifest → permissive throughout shipped code; GPL-3.0 appears only as an
  optional model/extra, labelled.
- Fixed: `/files/` traversal prefix collision (`server.py`, with a raw-request
  regression test), library reset unscoped SQL → `LibraryStore.reset()`, `secrets` in a
  workflow `if`, unpinned `ruff` in CI, machine-local paths in 9 tracked files.
- Fixed after the first public CI run: a `rules-of-hooks` oxlint error (`useSceneNow`
  renamed), `clippy::filter_next` in `src-tauri/src/lib.rs`, and a `test_dynamic_port`
  timeout that discarded the child's diagnostics.
- Repo settings: public, private vulnerability reporting on, Dependabot alerts on
  (0 open), Dependabot security updates on, secret scanning + push protection on.
- `THIRD_PARTY_NOTICES.txt` now lists the packaging tool, `smplr` and the MPL-2.0
  build-time packages, and states that no copyleft code ships.

## Blocked

- **Gate C23 locally** (cargo clippy/check/test): `C:` has 3.6 GB free, every volume
  ≤3.6 GB, and the build guard refuses below 10 GB. CI runs the same job and it is
  green; re-run locally when disk allows.
- P3-3 ONNX chord/beat adapters: no weights can be downloaded here. Owner-only decision.
- A3 learning-studio plugin thread: named in the ledger, no code and no contract change
  requested — not started.

## Next action

Re-run gate C23 where disk allows, then pick the next open row in `tasks/WORKLIST.md`
(P3-3 is the only unchecked one) or the owner decisions listed in
`docs/REEL-ADOPTION-2026-10-27.md` §prior-backlog.
