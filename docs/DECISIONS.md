# music-assistant — decisions

Append-only. Supersede with a new entry; never rewrite history.

## ADR-001 — continuity documents seeded (2026-11-02)

- **Context:** the project had no recorded decisions, so a fresh agent had to re-derive intent.
- **Decision:** keep six short documents with one purpose each; `AGENTS.md` stays the operational contract.
- **Consequence:** unknowns are written as "not recorded" rather than invented; they are filled in as work happens.
- **Evidence:** branch `main`, last commit 00f9373 feat(practice): PianoVision legs A-C (engine, geometry, roll, score summary).

## ADR-002 — a MIDI target gets the player's transport model, not a second player (2026-11-07)

- **Context:** legs D–G (memory fade, fingering/staff HUD, MIDI target library, acoustic pitch input) were
  written but uncommitted; `docs/DECISIONS.md` ADR-001 named HEAD as legs A–C only. An imported `.mid`
  target was also a dead end: `MidiPracticePanel` mounted `PlayerSurface` only when `file` existed, so a
  target with no recording showed the "import a track" gate and the roll had no clock to fall against.
- **Decision:** close the leg boundary in git as one commit, and drive a target-only session with the repo's
  existing `Transport` state machine (`frontend/src/player/Transport.ts`) on a wall clock — same
  play/pause/seek/tick/loop/ended semantics, same `onPosition` / `onPlayingChange` / `practiceLoop` seams —
  instead of a second player or a second audio clock. The two clocks are mutually exclusive by
  construction: the wall-clock transport only renders when no audio source is open.
- **Rejected:** a second `<audio>`/Web Audio element for MIDI targets (double transport, double state, and
  nothing to hear); deriving practice time from `setInterval` inside the panel (a second clock the roll
  would have to be taught about); implementing the ONNX chord/beat adapters instead (P3-3 needs weights
  that cannot be fetched on this machine — 7.3 GB free, no torch/onnx).
- **Consequence:** a `.mid` target practises on its own metronome clock and says so; adding the recording
  later still switches to the worklet clock with no state migration. Section loops from the score summary
  work in both modes. With no audio there is no transpose/speed/formant — the bar states that rather than
  implying otherwise.
- **Evidence:** `npx --no-install vitest run` → 14 files / 153 passed (was 13/141); `tsc -b` exit 0;
  `.venv\Scripts\python.exe -m pytest -m "not slow" --basetemp /c/np` exit 0. Receipt:
  `docs/evidence/orchestrate-2026-11-07.md`.
