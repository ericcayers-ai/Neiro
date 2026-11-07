# Reel adoption notes - 2026-10-27

Sources: four Instagram reels digested 2026-10-27 plus the WASCAPE request. Full rationale:
`C:\Users\ericc\.dsh\handoffs\2026-10-27-reel-widescope\HANDOFF.md` and `PROJECT-DECISIONS.md`.
Owner-approved browser default: `obscura` v0.2.5 (see `~/.pi/agent/AGENTS.md`).

Status: notes only. Nothing below is implemented yet. Owner rule for this repo: agents never commit.

## Verdict

**B ADOPT (primary).** Transpose 6.5.4 parity becomes a gate artefact, not prose: `/replica-recon`
over Transpose's public docs and store listing produces `docs/parity/features.csv`, `parity.py` is
wired into `scripts/verify_goal.py`, and `sweep.py --avoid "Transpose"` is the clean-room check.
**D ADAPT.** An eval set for the LLM-driven import/copilot paths. `brand`/`launch`/`deploy` stay out:
the goal is capability parity, not rebranding. A/C/E do not apply.

## By source

| Source | Applies | How it would be implemented here | Gate |
|---|---|---|---|
| A - obscura browser | no | Nothing to capture: the UI is served locally by the engine (`src/neiro/ui`) and live-site browser e2e stays owner-run (`GOAL.md:28`). | none |
| B - replica parity method | yes | new file: `docs/parity/features.csv` (must-have rows). new file: `docs/parity/parity.py` (row set versus code and receipts). Wire both into the `CRITERIA` table of `scripts/verify_goal.py`, which today runs C1-C23 and asserts one check per row. The clean-room check is a new `sweep.py --avoid "Transpose"` pass over this tree. | `python scripts/verify_goal.py` |
| C - measured render loop | no | No rendered output to measure; audio claims are carried by `scripts/benchmark.py` and the receipts in `docs/evidence/`. | none |
| D - eval sets / guardrails / cited retrieval | yes, deferred | No LLM module exists under `src/neiro` today: a grep for `llm` or `copilot` matches only minified bundle text in `src/neiro/ui/static/assets/`, never a source module. The set would follow the existing harness shape in `scripts/eval/run_musdb.py` as new file: `scripts/eval/run_import_eval.py` once an import/copilot path lands. | none yet - a new criterion is needed |
| E - WASCAPE | no | No 3D capture, no streaming delivery layer. | none |

## Parity target (this project)

Upstream is **Transpose 6.5.4** (Tune73, commercial, closed). Parity is *capability* parity only:
no code, UI, locales, images, CDN artefacts or `rb.wasm` may be copied - the boundary list is
`GOAL.md:33` and the goal line naming "every Transpose 6.5.4 capability clean-room" is `GOAL.md:3`.

No parity document exists in this repo yet (`docs/parity/` is absent). The artefact is therefore
`docs/parity/features.csv` with `docs/parity/parity.py` reading it, both new files, joined by one
new criterion in `scripts/verify_goal.py` so the gate keeps its "one check per row" contract. The
recon pass itself has no local `/replica-recon` command installed - it is the replica-skill method
applied by hand to Transpose's public docs and App Store listing, recorded row by row.

## Rejected, with reason

- **A obscura** - the app is a local Tauri/browser shell over `127.0.0.1`; a capture engine adds nothing to receipts.
- **C measured render loop** - no image or frame is produced to measure; audio work is already gated.
- **E WASCAPE** - no 3D authoring or splat delivery surface here.
- **`brand` / `launch` / `deploy` from B** - the goal is capability parity, not rebranding or store launch.
- **D today** - there is no LLM-driven import or copilot path to score; building an empty harness would be scaffolding.

## First step

Write `docs/parity/features.csv` with the Transpose 6.5.4 must-haves, then add its check to
`scripts/verify_goal.py` and run `python scripts/verify_goal.py --only <new id>` until the missing
must-have fails and the complete row set passes.

## Not verified here

No Transpose 6.5.4 documentation or store listing was read for this note, so no row of the matrix is
drafted. The worktree was already dirty before this file was added; nothing else was touched, and
nothing was committed.

## Prior backlog, consolidated (2026-10-27)

Older owner requests that belong to this project, with the status the reconciled ledger recorded.
Source: `C:\Users\ericc\.dsh\handoffs\2026-10-27-reel-widescope\PRIOR-BACKLOG-BY-PROJECT.md`
(derived from `dm-context-ledger.md`, the 2026-10-26 run reports and `fullinstadmNOTES.md`).
Statuses are 2026-10-26/27 receipts, not re-verified today: re-run this repo's gate before calling
anything done.

| # | Item | Status |
|---|---|---|
| A3 | Learning-studio plugin thread, "expand on Neiro" | OPEN - the thread is named in the ledger; no plugin code for it is recorded here |
| - | PianoVision legs A-C committed as 00f9373 (9 files, +2081) | DONE as recorded - tsc -b 0, vitest 12 files / 133 tests, pytest 32 and 51 passed on the two slices |
| - | PianoVision legs D and F: memory fade in MidiPracticePanel, plus MIDI targets (midi_targets table, CRUD, API routes, LibraryModule mount) | DONE as recorded - read_midi_notes reports the file's own tempo and track names |
| - | Honest gap: an imported MIDI target has no transport of its own | OPEN - practising needs the audio open, and the UI says so through library.midiNeedsAudio |
| - | Owner decision: may verify_goal.py --full rewrite the tracked src/neiro/ui/static/ | OPEN - 20 of the 23 criteria pass without it |
| - | Owner decision: a silently-clicking backing track | OPEN - a product decision, not a bug fix |

### Prior sessions on this project
- pi 2026-10-25 - handoff leg 01: PreferencesModule and translate.ts.
- pi 2026-10-25 - P1 legA: the practice engine, engine.ts and its tests.
- pi 2026-10-25 - P2 legB: piano roll, MidiPracticePanel and the geometry tests.
- pi 2026-10-25 - P3 legC scoring surface and P4 legC fix: ScoreSummary and engine.ts again.

### What this means for the reel work above
Nothing in the table is duplicated by the parity rows: those record capability only, and GOAL.md:33
already bars copying Transpose code, UI, locales, images, CDN artefacts or rb.wasm, so a parity row
may never cite a copied asset as its evidence. The reel work does lean on one open row - the new
criterion joins the same CRITERIA table in verify_goal.py whose --full run is still an owner
decision. A3 is untouched.
