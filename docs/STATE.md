# music-assistant — state

Updated 2026-11-07 (orchestrated run). Keep under 60 lines.

## Verified at update time

- branch `main`, HEAD `00f9373` feat(practice): PianoVision legs A-C, 60 uncommitted paths.
- stack: python (`pyproject`, `.venv`), node/React/Vite (`frontend`), Tauri (`src-tauri`).
- Frontend gate (whole suite, run 2026-11-07):
  `cd frontend && npx --no-install vitest run` → **13 files / 141 tests passed**.
  `vitest run src/practice` alone is 7 files / 114 tests — the 13/141 figure in
  `tasks/WORKLIST.md` is the full suite, not the practice subtree.
- Python gate: `.venv\Scripts\python.exe -m pytest -q -m "not slow" --basetemp C:\np`
  (the `--basetemp` is mandatory on Windows; see `HANDOFF.md` §14).

## In flight

- PianoVision legs D/E/F/G are written but uncommitted (HEAD carries A–C only).
  Untracked: `frontend/src/practice/{PianoVisionVRView.tsx,acousticPitch.ts,fingering.ts,
  library.ts,library.test.ts,memory.ts,memory.test.ts,pianovisionVr.test.tsx,vrCalibration.ts}`
  plus modified `PianoRoll.tsx`.
- MIDI-target practice had no transport of its own: the roll was driven only by
  `PlayerSurface`, so a target with no audio open had nothing to fall. Fixed in this
  run with `frontend/src/modules/midi/MidiTargetTransport.tsx`.

## Blocked

- P3-3 ONNX chord/beat adapters: no weights can be downloaded here (7.3 GB free, no
  torch/onnx). Owner-only download decision.
- A3 learning-studio plugin thread: named in the ledger, no code and no contract change
  requested — not started.

## Next action

Read `docs/evidence/orchestrate-2026-11-07.md` for the receipts, then pick the next open
row in `tasks/WORKLIST.md` (P3-3 is the only unchecked one) or the owner decisions listed
in `docs/REEL-ADOPTION-2026-10-27.md` §prior-backlog.
