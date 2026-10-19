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

## Fourth batch: disk preflight

The cache preference can no longer fill the volume: the live budget is capped at
half of free space, `POST /api/prefs` rejects a budget above 90% of free space, the
server prints a disk note under 8 GB free, and the snapshot exposes
`cache_budget_effective_gb`, `disk_free_gb` and `disk_tight`. New
`tests/test_disk_preflight.py` (3 tests) covers the low-disk cap, rejection and the
HTTP 400. About now documents the player/library shortcuts.

## Fifth batch: session export

`GET /api/session/export?name=` returns the portable session document (notes
included) and the Open-session dialog offers the same download. Covered by a
contract test (200 + notes, 404 for a missing session).

## Sixth batch: player → library promotion and catalogue completion

The Library detail view can import the player's local markers/clips for a song;
`librarySync.ts` parses and validates the snapshot (ordering, corrupt/missing data)
and is covered by Node tests. New player/MIDI/scene strings moved into the
`player/i18n.ts` catalogue. Player tests 28; gate 19/19.

## Seventh batch: transport seek controls

The player gains Start, a persisted ±5/±10/±30 s seek step, ArrowLeft/ArrowRight
seeking, Home/End, and a shared `clampSeek` helper with a Node test. Player tests 29.

## Eighth batch: remappable player keyboard shortcuts

`shortcuts.ts` defines nine actions with exact modifier matching, conflict
displacement, reset and local persistence; `PlayerShortcutPanel` exposes Learn/Clear
per action. Home/End and the wait-gate Space/Enter remain fixed by design. Player
tests 32; gate 19/19.

## Ninth batch: dynamic port contract

`neiro ui --port 0 --port-file <path>` binds an OS-chosen loopback port, reports
the real port to the file and prints the actual URL; `tests/test_dynamic_port.py`
spawns the CLI and checks health on that port. `docs/packaging.md` records the
Tauri contract (still unimplemented in Rust) and the sidecar/signing gap.

## Tenth batch: Studio target/backing focus

The Mix drawer gains a vocal-focus cross-fade (0–100%, neutral at 50%) applied to
target stems (vocals/singers) versus backing, via a bounded pure helper in
`player/mix.ts` with a Node test. It complements gain/pan/solo/mute; no stem model
or WebGPU path was added. Player tests 33; gate 19/19.

## Eleventh batch: frontend component tests

Vitest (node environment) renders `PlayerSurface` through `react-dom/server`:
transport/controls/labels/A4 readout, A–B/markers/clips/scenes/MIDI/shortcut
surfaces, the analysis overlay with a report, its absence without one, and the
no-duration gate. `npm test` runs it; gate C22 runs it with `--full`.

## Twelfth batch: preview tuner

`pitch.ts` adds autocorrelation detection (first-strong-peak to avoid octave-below
errors, parabolic refinement) and note/cents naming; the player samples a 60 ms
window every 300 ms while playing and shows "heard A4 +2¢". Covered by Node tests
for sines (A4/A3/C4), silence, noise and a positioned window. Player tests 36.

### Gate stability note

One gate run executed concurrently with a frontend build/vitest reported 21/22
without naming a failing criterion in the captured tail; two subsequent clean runs
reported **22/22** (`GATE PASS`). No criterion has failed in isolation. Treat the
single 21/22 as environmental contention from concurrent processes, not a known
defect; if it recurs, capture the full gate log before changing anything.

## Thirteenth batch: app-wide i18n scaffold

`src/i18n/` adds a pure `translate()` core (EN catalogue, interpolation, missing-key
fallback) and an `I18nProvider`/`useT()` with persisted locale selection. The shell
rail, hints and session menu now render through it; player strings remain in their
own catalogue. `docs/i18n.md` states the remaining extraction work and the absence
of RTL/plural support. Gate C18 now requires the shell catalogue.

## Fourteenth batch: library versions

The Library detail gains Save version (label prompt) and a version list; the API
endpoint is covered by an HTTP test. Versions are metadata/session pointers, not
duplicated audio. Library tests 11.

## Fifteenth batch: per-song player settings

Library songs store `settings.player` via `POST .../settings`; the Library player
passes them as `initialParams` and debounces parameter changes back (800 ms), so
transpose/speed/tuning survive a restart. API test + SSR test (A4 880 Hz at +12).
Library tests 12; vitest 6.

## Sixteenth batch: companion host policy and diagnostics

The addon declared no install-time host access, so its cross-origin calls to
`127.0.0.1` could not work. It now declares loopback-only host permissions
(`127.0.0.1`, `localhost`), requests `tabCapture` from the panel on the user's
click, and offers a "Check Neiro engine" health probe. The validator rejects
wildcard install access and checks the loopback policy (47 checks).
