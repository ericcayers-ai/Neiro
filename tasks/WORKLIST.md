# Neiro work list

One live list. Each item carries priority, state, the receipt that closes it, and
what specifically remains. Receipts are in `docs/evidence/`.

Legend: `[ ]` open · `[~]` partial · `[x]` closed with a receipt · `[!]` blocked.
Gate: `python scripts/verify_goal.py --full` — **18/18 PASS** on 2026-10-20.

## Phase 0 — truth, regression safety, security

- [x] **P0-1 Pitch-correct fix committed + regression test.** `tests/test_pitch_correct_report.py`;
  commit `cf6c35b`.
- [x] **P0-2 Auto-enhance no-op contract.** `result.noop == true` + `reason`, no `file_id`;
  API + unit tests in `tests/test_contract_truth.py`.
- [x] **P0-3 Session notes scalar (5 000 cap).** Round-trip, over-cap and legacy
  character-list migration tests.
- [x] **P0-4 `verify_models.py` interpreter-safe.** `cli_models_output()` + test.
- [x] **P0-5 `ruff format --check .` green.** Two fenced doc examples fixed.
- [x] **P0-6 API security.** Token, loopback Host, Origin allowlist, JSON content
  type, body/upload caps, disk preflight, plugin/tool consent, SSRF policy, CORS
  allowlist, pairing. 21 security tests.
- [x] **P0-7 Practice honesty.** Player-backed count-in, A–B, wait gate, provenance
  labels; whole-file `<audio>` and offline stretch removed.
- [x] **P0-8 Analysis honesty.** Confidence/no-result, heuristic labels, UI lanes.
- [x] **P0-9 Docs truth pass.** README/SECURITY/session/performance/traceability
  corrected; banner updated.
- [x] **P0-10 Frontend test runner.** Vitest + SSR `PlayerSurface` tests (5),
  wired to `npm test` and gate C22.
- [ ] **P0-11 Short-basetemp note in test docs.** `pytest` still needs
  `--basetemp C:\np` on Windows; document it in the contributing guide.

## Phase 1 — shared real-time player

- [x] **P1-1 Player SDK skeleton.** `frontend/src/player/`.
- [x] **P1-2 Worklet DSP.** Phase-vocoder stretch, resample pitch, formant warp,
  6-band EQ, vocal reducer, bypass.
- [x] **P1-3 Transport.** Sample clock, play/pause/seek, A–B, count-in, metronome,
  markers, wait gate.
- [x] **P1-4 PlayerSurface UI.** Controls, method label, latency readout, markers,
  clips, ramp.
- [x] **P1-5 MIDI Practice migrated.** Uses `PlayerSurface`; DAW MIDI resumes a gate.
- [~] **P1-6 Studio transport migration.** Studio still owns its timeline `<audio>`
  for stem playback; Mix gain/pan and A–B are unchanged. Remaining: route Studio
  transport through `PlayerEngine`.
- [x] **P1-7 Tests + latency receipt.** 37 Node tests; `docs/evidence/player-latency-2026-10-20.md`.
- [x] **P1-8 Render preview settings (Q).** `render` edit job applies speed+pitch and
  returns a downloadable WAV with provenance; contract test covers duration.

## Phase 2 — practice and library

- [x] **P2-1 SQLite library.** `src/neiro/library/store.py`, schema versioned.
- [x] **P2-2 API.** Songs/notes/markers/clips/scenes/playlists/versions/export/audio.
- [x] **P2-3 Library UI.** List, notes with counter, markers, clips, Favorites,
  player, export, remove.
- [x] **P2-4 Practice ramp generator.** Chromatic / fifths / scale in the player.
- [x] **P2-5 MIDI learn + mapping persistence.** `midi.ts` + `PlayerMidiPanel`:
  note/CC learn for 11 actions, any device, clear per action, local persistence.
  Player keyboard shortcuts are remappable too (9 actions, conflict handling,
  reset); app-wide rail shortcuts remain fixed. 32 player tests.
- [x] **P2-10 Studio target/backing focus.** Mix drawer cross-fades vocals/singers against
  the backing (neutral at 50%, bounded), with a pure `focusGain` helper and test.
  Stem-solo/mute/gain/pan behaviour is unchanged.
- [~] **P2-6 Byte-bounded cache + disk preflight.** Upload preflight/507, a disk-aware
  effective cache budget (half of free space), update rejection above 90% free, and
  a startup disk note exist. Remaining: model-size preflight before downloads and a
  library-side quota.
- [x] **P2-7 Library resume/reset and per-song last-played.** Resume last, reset with
  confirmation, mark played on open; localStorage player reset lives in Prefs.
- [x] **P2-8 Session export.** `GET /api/session/export?name=` + Open-dialog download; test
  covers the returned document and notes.
- [x] **P2-9 Promote player markers/clips into the library.** One-click import in the
  Library detail view; `librarySync.ts` parses/tolerates the localStorage snapshot
  and `tests` cover ordering and corrupt data. Automatic promotion on save remains
  a follow-up.

## Phase 3 — real analysis

- [x] **P3-1 Chord timeline.** Beat-synchronous chroma, 24 triads, confidence.
- [x] **P3-2 Beat grid.** Onset-flux phase search, 4/4 downbeats with confidence.
- [x] **P3-7 Studio chord lane.** "Chords" button fetches the heuristic timeline for
  the first track and draws it in the visible window (`chordLane` helper + test).
- [ ] **P3-3 Optional ONNX chord/beat adapters.** Manifests/reporting for
  ChordMini/BTC and Beat This-class are not implemented; no weights downloaded.
- [x] **P3-4 Analysis UI.** Chord lane, beat lane, key/meter, no-result state.
- [x] **P3-5 Analysis timeline overlay inside the player.** Chord blocks and beat
  ticks render from the `AnalysisReport` under the transport.

## Phase 4 — optional companion

- [x] **P4-1 MV3 skeleton.** Manifest, service worker, side panel, offscreen, popup.
- [x] **P4-2 Site adapters.** YouTube/Spotify/SoundCloud/Deezer/Apple Music/Tidal/
  Vimeo + generic fallback; injected on demand.
- [x] **P4-3 Tab capture.** Offscreen worklet, stop/restore, no double audio by
  design (Chrome mutes the captured tab).
- [x] **P4-4 Pairing.** 6-digit code → token, rotated after use; Q gate.
- [x] **P4-5 Static validator + tests.** 47 validator checks, 5 worklet tests.
- [x] **P4-7 Companion engine diagnostics + host policy.** Loopback host permission
  for pairing/health/upload (no wildcard), tabCapture requested from the panel on
  Start, and a "Check Neiro engine" health probe.
- [!] **P4-6 Live-site e2e `OWNER`.** Requires a real browser profile and logins;
  not run here.

## Phase 5 — i18n, a11y, packaging

- [~] **P5-1 String catalogue.** Shell/navigation goes through `src/i18n/`
  (`I18nProvider`, `useT`, en catalogue, fallback, persistence) and player strings
  through `player/i18n.ts`; module bodies remain English JSX. No copied locales.
- [~] **P5-2 Accessibility.** Baseline labels/live regions/keyboard + a clean
  static audit (`scripts/a11y_static.py`, gate C21). Axe, screen-reader and
  colour-contrast passes remain owner-run.
- [~] **P5-3 Dynamic port + bundled sidecar/signing.** `neiro ui --port 0
  --port-file` is implemented and tested (`tests/test_dynamic_port.py`,
  `docs/packaging.md`); Tauri still spawns system Python and has no sidecar,
  signing or updater.
- [ ] **P5-4 Model manager status.** Sizes/licences/needs-install exist in Prefs;
  disk-impact and install/remove flow are incomplete.

## Phase 6 — release evidence

- [x] **P6-1 Gate + receipts.** `docs/evidence/implementation-2026-10-20.md`.
- [x] **P6-2 Audit + handoff addenda.** `docs/AUDIT.md` §13, `HANDOFF.md` §14.
- [x] **P6-3 Owner decisions recorded.** Local-first scope, clean-room DSP, hybrid
  addon, sidecar packaging direction, pitch fix committed.
- [ ] **P6-4 Rust build/clippy and signed installer** (owner/machine capacity).
- [x] **P6-5 Disk preflight.** `tests/test_disk_preflight.py`; low-disk states cap the
  live cache budget and reject unsafe preferences.
