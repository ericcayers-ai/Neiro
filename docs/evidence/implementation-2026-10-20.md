# Implementation receipt — 2026-10-20

Single implementation pass from `HANDOFF.md` and `docs/AUDIT.md`, executed against
`music-assistant` at `c3cc5c0` with the owner's dirty worktree preserved.

## Gate

```powershell
.\.venv\Scripts\python.exe scripts\verify_goal.py --full
```

```
PASS criterion-set: 18 criteria matched
PASS C1: fix committed; regression test passes
PASS C2: 262 passed, 3 skipped in 52.60s
PASS C3: ruff check + format clean
PASS C4: tsc + vite build pass
PASS C5: 2 passed, 7 deselected in 2.86s
PASS C6: 3 passed, 6 deselected in 0.76s
PASS C7: 1 passed, 8 deselected in 1.85s
PASS C8: 21 passed in 12.75s
PASS C9: 3 passed, 18 deselected in 1.75s
PASS C10: SDK + worklet + tests + measured latency receipt
PASS C11: practice panel uses the shared player; no whole-file loop or false claim
PASS C12: 8 passed in 4.34s
PASS C13: 5 passed in 3.42s
PASS C14: PASS panel explains optional pairing | Addon validation: 46 passed, 0 failed
PASS C15: README/SECURITY/session/traceability claims current
PASS C16: no rb.wasm; notices present
PASS C17: 2 passed, 7 deselected in 1.54s
PASS C18: string catalogue module + accessibility notes present

GATE PASS — 18/18 criteria
```

## Supporting checks

| Command | Result |
|---|---|
| `python -m pytest -q -m "not slow" --basetemp C:\np` | 262 passed, 3 skipped |
| `python -m pytest -q tests/test_pitch_correct_report.py` | 2 passed (regression for the job-progress bug) |
| `node --test frontend/src/player/tests/*.test.mjs` | 26 passed |
| `node --test addon/tests/capture.test.mjs` | 5 passed |
| `node addon/scripts/validate.mjs` | 46 passed, 0 failed |
| `node frontend/src/player/tests/bench.mjs` | worst render factor 5.23×, algorithmic latency 23.2 ms |
| `npm run build` (frontend) | tsc + vite build pass; worklet emitted as an asset |
| `ruff check .` / `ruff format --check .` | clean |
| `git log --grep=pitch_correct` | commit `cf6c35b` |
| Live smoke: `neiro ui --port 8381` + real HTTP | health 200; token issued; mutation 401 without token / 200 with it; `text/plain` 415; OPTIONS 204 + echoed ACAO; upload 200; library add/note/read 200; pair exchange 200; SPA 200 |
| `GET /assets/player-worklet-*.js` | 200, `text/javascript`, 27,475 bytes (the worklet is served) |
| `GET /api/library/export` | 200, `application/json` |

## What changed (by area)

- **Truth contracts:** pitch-correct progress uses `ctx.report`/`Progress`; auto-
  enhance returns `noop: true` + `reason` instead of a done-with-no-file; session
  notes are a scalar with a 5,000-character cap and legacy char-list migration;
  `verify_models.py` uses `sys.executable -m neiro.cli`.
- **API:** token, loopback Host, Origin allowlist, strict JSON content type, JSON
  and upload caps plus disk preflight, plugin/tool consent, URL-ingest policy,
  CORS allowlist, companion pairing; DAW bridge exemption documented and tested.
- **Queued edits:** `POST /api/edit/job` runs stretch/pitch/pitch-correct with
  progress, cancel, provenance and a bounded `(file_id, op, params)` cache.
- **Player:** one context, worklet DSP (phase vocoder, resample pitch, cepstral
  formant warp, EQ, reducer), transport with real A–B/count-in/metronome/wait,
  markers, clips, ramp, `PlayerSurface`, honest method labels and measured latency.
- **Practice:** `MidiPracticePanel` now uses the player; no whole-file `<audio>`,
  no offline stretch, no dead count-in, no unconditional "pitch-preserving" claim.
- **Library:** SQLite store + REST API + Library module with notes, markers, clips,
  scenes, playlists, versions and local export; audio streams only from the stored
  path.
- **Analysis:** beat-synchronous chord timeline (24 triads), onset-flux beat grid,
  confidence/no-result states, heuristic labels, and chord/beat lanes in the UI.
- **Companion:** optional MV3 addon with tab capture through a clean-room granular
  shifter, site adapters, pairing and queued upload; static validator and tests.
- **Docs:** `GOAL.md`, work list, tracker, player/library/companion/accessibility
  docs, notices, and truth corrections to README/SECURITY/session/performance/
  traceability.

## Not done / not claimed

- Browser end-to-end (live capture, control-to-audio latency, listening quality) was
  not run; the companion live-site check is owner-run.
- Rust `cargo check`/clippy and a signed installer were not run.
- Analysis remains heuristic; no neural chord/beat model was installed or exercised.
- i18n is English-only (catalogue in place); no axe/screen-reader audit.
- Player-created markers are not auto-promoted into the library.

## Second parity batch (same day)

After the first gate pass: MIDI learn/mapping (note/CC, 11 actions, persistence),
player scenes, chord/beat overlay in the player, sounding-A4 readout, previous/next
marker transport, and an honest low-latency mode (formant off, labelled). Player
tests grew to 26; the gate was re-run and remains **18/18 PASS**.

## Third batch: library lifecycle and reset

Library gains per-song last-played (`POST .../played`), a confirm-gated
`POST /api/library/reset` that removes songs but never audio files, a Resume-last
action, and a Prefs "Data and reset" card for player/MIDI local state. Library tests
grew to 10; the gate remains **18/18 PASS**.
