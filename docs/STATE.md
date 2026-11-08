# music-assistant — state

Updated 2026-11-08 (public-release audit). Keep under 60 lines.

## Verified at update time

- branch `main`, tree clean after the release-audit commits.
- stack: python (`pyproject`, `.venv`), node/React/Vite (`frontend`), Tauri (`src-tauri`).
- Python gate: `.venv\Scripts\python.exe -m pytest -q -m "not slow" --basetemp C:\np`
  → **299 passed, 3 skipped** (the `--basetemp` is mandatory on Windows; see `HANDOFF.md` §14).
- Frontend gate: `cd frontend && npx --no-install vitest run` → **153 tests passed**;
  `tsc -b` + `vite build` pass; `npx oxlint` clean.
- Goal gate: `python scripts/verify_goal.py --full` → **22/23**, C23 (Rust) blocked by
  disk space, not by code. Receipts: `docs/evidence/security-release-audit-2026-11-08.md`.

## Public-release audit (2026-11-08)

- `cybersafe_scan.py` → 0 findings; secret/private-data scan over the tree **and full
  history** → 0 tree hits.
- Licence audit of 24 installed Python distributions, 93 frontend packages and every
  model manifest → permissive throughout shipped code; GPL-3.0 appears only as an
  optional model/extra, labelled.
- Fixed: `/files/` traversal prefix collision (`server.py`, with a raw-request
  regression test), library reset unscoped SQL → `LibraryStore.reset()`, `secrets` in a
  workflow `if`, unpinned `ruff` in CI, machine-local paths in 9 tracked files.
- `THIRD_PARTY_NOTICES.txt` now lists the packaging tool, `smplr` and the MPL-2.0
  build-time packages, and states that no copyleft code ships.

## Blocked

- **Gate C23** (cargo clippy/check/test): `C:` has 3.6 GB free, every volume ≤3.6 GB.
  `src-tauri/` is unchanged since the 2026-10-21 gate that recorded 23/23 and
  `cargo fmt --check` passes. Re-run on a machine with ≥10 GB free.
- P3-3 ONNX chord/beat adapters: no weights can be downloaded here. Owner-only decision.
- A3 learning-studio plugin thread: named in the ledger, no code and no contract change
  requested — not started.

## Next action

Re-run gate C23 where disk allows, then pick the next open row in `tasks/WORKLIST.md`
(P3-3 is the only unchecked one) or the owner decisions listed in
`docs/REEL-ADOPTION-2026-10-27.md` §prior-backlog.
