# Orchestrated run — 2026-11-07 (music-assistant / Neiro)

One background `pi -p` session, one owner, no subagents. Mission: close the open work the
project's own trackers record, close the commit gap, and make the gate the receipt; then, if
time remains, implement the MIDI-target transport instead of the ONNX adapters (weights can
not be downloaded here).

Everything below is a command that was run in this session, on this tree.

---

## 1. What was measured before any edit

```
$ git log --oneline -1
00f9373 feat(practice): PianoVision legs A-C (engine, geometry, roll, score summary)
$ git status --porcelain | wc -l
60
$ df -h /c
C: 931G 924G 7.3G 100% /c
```

Legs D–G were present in the worktree and uncommitted: `frontend/src/practice/{PianoVisionVRView.tsx,
acousticPitch.ts, fingering.ts, library.ts, library.test.ts, memory.ts, memory.test.ts,
pianovisionVr.test.tsx, vrCalibration.ts}` untracked, `PianoRoll.tsx` + `PianoRoll.test.tsx` modified.

Baseline frontend gate:

```
$ cd frontend && npx --no-install vitest run src/practice
 Test Files  7 passed (7)
      Tests  114 passed (114)
$ cd frontend && npx --no-install vitest run
 Test Files  13 passed (13)
      Tests  141 passed (141)
```

That is the first finding of the run: the `13 files / 141 passed` figure recorded in
`tasks/WORKLIST.md` P7-5 is the **whole** frontend suite, not `src/practice`. Recorded in
`docs/STATE.md` and `HANDOFF.md` §15 so the number stops being read as the practice subtree.

Reel digest (read-only, its own interpreter):

```
$ cd C:/Users/ericc/.pi/agent/reelkit && ./venv/Scripts/python.exe rq.py project music-assistant
# 42 Oct 28, 2026 note  task-note   Reimplement the entirety of PianoVision in VR
# 82 Oct 24, 2026 reel  adopt       gokayfem/shader-skills: 186 pre-tested GLSL shader functions …
#246 May 27, 2026 other-url reference   Scribd document of Michael Jackson multitracks (stems reference)
$ … rq.py show 42      → verdict "task-note — Owner instruction naming one target app and one delivery mode (VR)"
$ … rq.py search webxr → no match
$ … rq.py search "practice mode MIDI transport" → no match
$ … rq.py notes music-assistant → the same item #42
```

No open verdict contradicted the work order. Item #82 (`adopt`, GLSL shader skills) has an owner
elsewhere (`geolocating-superskill` / `digital-earth`) and belongs to no file in this repo, so it was
not applied here; item #246 is a reference, not a directive.

## 2. Open items, re-verified one by one

| Claim in the work order | Verified? | Command / evidence |
|---|---|---|
| Legs D/E/F/G written but uncommitted; HEAD carries A–C only | **true** | `git status --porcelain` (9 untracked practice files + modified `PianoRoll.tsx`); `docs/DECISIONS.md` ADR-001 names HEAD as A–C |
| Only open checklist row is P3-3 ONNX adapters | **true** | `tasks/WORKLIST.md:108-109` unchecked; `grep -il onnx src frontend/src` returns only manifests/`backends.py`, no chord/beat adapter |
| MIDI-target practice has no transport of its own | **true** | `frontend/src/library/MidiTargets.tsx:138` and `library.midiNeedsAudio`; `MidiPracticePanel` mounted `PlayerSurface` under `{file && …}` only |
| A3 learning-studio plugin thread has no code | **true** | `docs/REEL-ADOPTION-2026-10-27.md` prior-backlog row A3; no plugin source in the tree |

Nothing was already closed; nothing was dropped.

## 3. MIDI-target transport (the code change)

**The seam.** `MidiPracticePanel` already received transport position from exactly one place —
`PlayerSurface.onPosition` — and the roll, the practice engine's judge, the pass recorder and the
score summary all key off that one stream. A target-only session rendered no `PlayerSurface`, so
the panel fell through to the "Import (and optionally transcribe) a track" gate.

**The fix, using what the repo already had.** `frontend/src/player/Transport.ts` is a tested, pure
transport state machine (play / pause / seek / `tick(dt)` → `'loop' | 'wait' | 'ended'`, loop range,
count-in length). The new `frontend/src/modules/midi/MidiTargetTransport.tsx` drives **that** class
from a wall clock and exposes the same three seams the player exposes (`onPosition`,
`onPlayingChange`, `practiceLoop`). No second player, no second audio clock, and the two clocks are
mutually exclusive: the panel renders the wall-clock bar only when no audio source is open.

Files:

- `frontend/src/modules/midi/MidiTargetTransport.tsx` (new) — play/pause/restart, section-loop
  request, ~10 Hz readout, honest label: "metronome clock · N BPM · no audio open, so no transpose,
  speed or formant controls here". Frame source is an injectable seam (`FrameLoop`) so tests step
  time by hand instead of waiting on timers.
- `frontend/src/practice/library.ts` — `targetEndSec()`: the transport wants absolute target time,
  while `describeTarget().durationSec` is the span between first onset and last offset (right for a
  card, wrong for a clock when a target does not start at 0).
- `frontend/src/modules/midi/MidiPracticePanel.tsx` — gate relaxed to
  `!file && !dawConnected && practiceNotes.length === 0`; the wall-clock transport mounts in the
  `!file` branch with the same handlers the player gets; gate copy now names MIDI targets.
- `frontend/src/library/MidiTargets.tsx` — the "Practise" message no longer tells the user the audio
  is required.
- `frontend/src/i18n/translate.ts` — `practice.target{TransportAria,Play,Pause,Restart,ClockMethod,
  NoAudio}` and `library.midiOwnClock` replace `library.midiNeedsAudio`.

**Tests added (12 new):**

- `frontend/src/modules/midi/MidiTargetTransport.test.tsx` — 7: label/tempo, positions on the
  player's seam, stop-at-end reported once, section-loop seek, section-loop wrap, restart drops a
  leftover loop, pause ends a pass exactly once.
- `frontend/src/modules/midi/MidiPracticePanel.test.tsx` — 2: a target-only panel renders the
  transport instead of the gate (player not mounted, transport is, with the target's own length);
  judging end to end against the target clock (100%, 2 notes judged).
- `frontend/src/practice/library.test.ts` — 3: `targetEndSec` is absolute not a span, offset-less
  notes fall back to the onset, empty target is 0.

## 4. Gate receipts (after the change)

```
$ cd frontend && npx --no-install vitest run src/practice
 Test Files  7 passed (7)
      Tests  117 passed (117)

$ cd frontend && npx --no-install vitest run
 ✓ src/modules/midi/MidiTargetTransport.test.tsx (7 tests) 87ms
 ✓ src/practice/library.test.ts (16 tests) 11ms
 ✓ src/modules/midi/MidiPracticePanel.test.tsx (4 tests) 156ms
 …
 Test Files  14 passed (14)
      Tests  153 passed (153)

$ cd frontend && npx --no-install tsc -b ; echo "exit=$?"
exit=0

$ cd frontend && npx --no-install oxlint src/modules/midi src/practice
src/practice/PianoRoll.tsx:80  warning react(only-export-components)      # pre-existing
src/practice/PianoVisionVRView.tsx:71  warning react(only-export-components) # pre-existing
src/modules/midi/PianoRollView.tsx:29  warning react(only-export-components) # pre-existing
src/modules/midi/PianoRollView.tsx:126 warning react-hooks(exhaustive-deps) # pre-existing
src/modules/midi/PianoRollView.tsx:119 warning react-hooks(exhaustive-deps) # pre-existing

$ cd frontend && node --test src/player/tests/logic.test.mjs
ℹ tests 32   ℹ pass 32   ℹ fail 0

$ .venv\Scripts\python.exe -m pytest -m "not slow" --basetemp C:\np
297 passed, 1 skipped, 2 deselected in 64.27s   (exit 0)
```

Before/after: **13 files / 141 tests → 14 files / 153 tests** (vitest), **7/114 → 7/117** for the
practice subtree, pytest **297 passed / 1 skipped** unchanged in count of failures, `tsc -b` 0.

Note on the Python number: `pyproject.toml` already carries `addopts = "-q"`, so adding a second
`-q` on the command line (`-qq`) suppresses pytest's summary line entirely — an exit code with no
count. The run above omits the extra `-q`.

## 5. Commit gap

Three coherent local commits (no push, no history rewrite):

1. `feat(practice): PianoVision legs D-G + MIDI target transport` — the practice/MIDI-target code,
   its Python counterpart (`library/store.py`, `symbolic/midi.py`, `ui/library_api.py`,
   `ui/server.py`, `tests/test_library_midi_targets.py`), the API client/types, the practice
   catalogue keys, and `frontend/vitest.config.ts` (the `*.test.ts` include the practice engine
   needs). Also carries the `prefs.*` catalogue keys that commit 2 consumes — one file, two readers.
2. `i18n(prefs): extract the Preferences module strings` — `PreferencesModule.tsx` + its SSR test.
3. `feat(player): scene snapshots capture the panel arrangement` — `player/scenes.ts` +
   `player/tests/logic.test.mjs`.

Plus the repository-hygiene commit that stops 131 MiB of regenerated sidecar and a 100 MiB graph from
sitting in `git status`, and the continuity documents committed with them.

## 6. What remains (and why)

| Item | Why it is still open |
|---|---|
| **P3-3 ONNX chord/beat adapters** | **Blocked, external.** No ChordMini/BTC or Beat This-class weights are obtainable here (7.3 GB free, no torch/onnx in `.venv`, no download approved). Nothing in the repo can substitute for them; the DSP heuristics stay the labelled fallback. |
| **A3 learning-studio plugin thread** | No contract was requested and no code exists; starting it would invent scope. `learning-studio` is a consumer of this repo's bridge contract, not a file here. |
| Owner decisions from `docs/REEL-ADOPTION-2026-10-27.md` | Whether `verify_goal.py --full` may rewrite the tracked `src/neiro/ui/static/`, and whether a backing track may be silently clicky. Both are product/process calls, not fixes. |
| Signed installers / clean-VM / live-site companion e2e / listening panel | Unchanged from `HANDOFF.md` §14 "What is still not proven". |

Not checked in this run, stated plainly: no audio was listened to, so no claim is made about how the
metronome clock *feels* against a real performance; no live engine was started, so the Python side is
verified by its test suite only; `vitest` ran in `node`/`jsdom`, so the WebXR stage's device paths are
covered by the existing unit tests, not by a headset.
