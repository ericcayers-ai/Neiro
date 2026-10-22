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

Earlier 22/23 runs were first blamed on concurrency. With a full log captured, the
real cause was found: `test_prefs_get_update_and_flush` compared the cache's exact
byte budget with a **rounded** GB field, and only fails when the effective budget is
disk-clamped (it passed while disk was plentiful). Fixed by exposing
`cache_budget_effective_bytes` and comparing exact bytes (see the batch below).
After that fix, the full gate is **23/23**; there is no evidence of a flaky
criterion, and failures should be reproduced from the full log before any change.

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

## Seventeenth batch: render preview settings (Q)

`/api/edit/job` gains a `render` op that applies the player's current speed (as a
duration scale) and pitch (semitones + cents) in one queued job, with combined
provenance. The player exposes "Render with Neiro", polls the job, and offers the
rendered WAV for download. Contract test checks duration and provenance; SSR test
checks the control is present.

## Eighteenth batch: Studio chord lane

Studio adds a "Chords" action that fetches the heuristic analysis for the first
track and draws the chord segments inside the visible timeline window; `chordLane`
is a pure helper with clamping/visibility tests. Player tests 38.

## Nineteenth batch: model weight removal

`ModelEntry.remove_download()` deletes only `<models>/<id>` and its fetched marker,
with a path-escape guard; `POST /api/models/remove` requires a token and
`confirm:true`; Prefs shows Remove for downloaded models and reports freed bytes.
A scoped test proves unrelated model data survives. Download-preflight tests 4.

## Twentieth batch: compact player mode

The player header toggles a compact mode that hides markers/clips/scenes/MIDI
panels in the markup (not only via CSS), persists per file, and is covered by an
SSR test. Vitest 7.

## Twenty-first batch: Tauri dynamic port (compiled)

The shell reserves a free loopback port, spawns the engine on it, reuses it across
restarts, probes health, then navigates the main window from `about:blank` to the
live URL; CSP allows loopback on any port and `engine_status` reports the live URL.

```
cargo fmt --check                         exit 0
cargo clippy -- -D warnings               exit 0
cargo check                               exit 0  (1m14s first run, cached after)
```

Not verified: GUI launch, restart behaviour under a real window, fresh-machine
sidecar. Those remain owner steps; `docs/packaging.md` says so.

## Twenty-second batch: standalone model-free sidecar

`scripts/build_sidecar.py` builds `packaging/neiro.spec` with PyInstaller 6.22.3.
Measured build ~39 s; output `dist/neiro/neiro.exe` (~11 MB) + runtime folder.

Verified directly (no GUI, no system Python on the child process):

```
neiro.exe --version            -> neiro 1.2.1
neiro.exe ui --no-browser --port 0 --port-file <tmp>
GET http://127.0.0.1:<chosen>/api/health -> 200 ok (port 58546)
```

`src-tauri/src/lib.rs` now tries bundled engine paths next to the app binary
(`neiro-engine`, `engine/`, `resources/engine/`, `resources/`) before falling back
to Python; `cargo fmt/clippy/check` pass (gate C23). Bundling the folder into the
Tauri resources, signing and a fresh-machine test remain owner steps.

## Twenty-third batch: Tauri release build with resource wiring

`bundle.resources = ["resources/engine"]` plus a tracked README; the config
validates (`cargo check`). A release compile:

```
npx --prefix frontend tauri build --no-bundle   ->  Finished release in 2m32s
Built application at: src-tauri/target/release/neiro.exe
```

Not verified: copying/shipping the engine in the bundle, installer, signing,
launch on a fresh machine.

## Twenty-fourth batch: installers with the bundled engine

Staged the PyInstaller engine at `src-tauri/resources/engine/neiro-engine.exe` and
ran a full `npx tauri build`:

```
Finished 2 bundles:
  target/release/bundle/msi/Neiro_1.2.1_x64_en-US.msi          56.0 MB
  target/release/bundle/nsis/Neiro_1.2.1_x64-setup.exe         38.3 MB
```

Payload verification (no install performed): `msiexec /a <msi> TARGETDIR=<temp>`
extracted `PFiles\Neiro\neiro.exe`, `resources\engine\neiro-engine.exe`
(10.5 MB) and `resources\engine\_internal\` (numpy, etc.) — the exact path the
shell probes.

Not verified: signed installers, updater, fresh-machine launch, uninstall.

## Twenty-fifth batch: bundled-engine launch verified

MSI extracted with `msiexec /a` (no install). PATH set to
`%SystemRoot%\system32;%SystemRoot%` (no Python). Launched
`PFiles\Neiro\neiro.exe`:

```
APP PID=56592 exited=False
child: neiro-engine.exe  "…\resources\engine\neiro-engine.exe"
child: msedgewebview2.exe
WINDOW=Neiro
```

Processes terminated after 15 s. This proves the shell takes the bundled-engine
path with no system Python reachable. Not a clean-VM test (WebView2 preinstalled);
signed installer, updater and uninstall remain owner steps.

## Twenty-sixth batch: Studio real-time player dialog

Studio gains a Real-time action that pauses its multi-track transport and opens the
selected/first track in `PlayerSurface` (full RT controls, method label, tuner,
render). It is an integration, not a per-stem engine: the studio clock and the
player clock never run at once.

## Twenty-seventh batch: acceptance sweep

Refreshed HANDOFF §14 and AUDIT §13.6 so the execution entry point matches the
current gate and commits. Verified in this sweep: gate 23/23; 276 Python tests;
38 player Node tests; 7 vitest SSR tests; 47 addon checks; `cargo fmt/clippy/check`;
installers and bundled-engine launch receipts; no `rb.wasm`; owner worktree changes
still untouched. Remaining gaps are the owner/toolchain-gated list in the worklist.

## Twenty-eighth batch: Library module catalogue

Library strings (songs, notes, markers, clips, versions, reset/import messages)
now resolve through the shell catalogue with interpolation; the component imports
`useT`. A completeness assertion checks representative `library.*` keys. Remaining
i18n work is Studio/Restore/Separate/MIDI/Prefs bodies plus RTL/plurals.

## Twenty-ninth batch: axe smoke on the player

Added `jsdom` + `axe-core` dev dependencies and `PlayerSurface.axe.test.tsx`
(jsdom environment): server-render → mount → axe. Latest: **8 vitest tests, 0
serious/critical violations**. Contrast/target-size rules are not evaluable in
jsdom and remain owner-run.

## Thirtieth batch: gate stability

Ran the full gate three times back-to-back on the same tree:

```
run 1 exit=0
run 2 exit=0
run 3 exit=0
GATE PASS — 23/23 criteria (each run)
```

This supersedes the earlier single-run stability caveat; the two mid-session
22/23 observations coincided with concurrent builds and were not reproducible in
isolation or in these three runs.

## Thirty-first batch: Import module catalogue

Import strings (browse, dropzone, queue, URL fetch, messages) resolve through the
shell catalogue with interpolation. Catalogued surfaces are now shell, player,
Import and Library; Studio/Restore/Separate/MIDI/Prefs remain JSX.

## Thirty-second batch: module shell SSR tests

`modules.ssr.test.tsx` server-renders Import and Library inside `I18nProvider` +
`SessionProvider` and asserts catalogue-sourced strings. Vitest is now **10 tests**
(3 files); the player axe test still passes. This gives the newly catalogued modules
a rendering check without a browser.

## Thirty-third batch: Restore module catalogue

Restore's gate, header, recommendation, results and actions resolve through the
catalogue; module SSR now renders the Restore empty gate too. Remaining bodies:
Studio, Separate, MIDI, Preferences (plus preset data).

## Thirty-fourth batch: Separate module catalogue

Separate's gate, header, preset/tier/bleed controls, queue hint and stem-result
actions resolve through the catalogue; module SSR renders the Separate empty gate
too. Remaining bodies: Studio, MIDI, Preferences.

## Thirty-fifth batch: Preferences catalogue

Preferences sections, controls, model-table headers, tool actions, compute fields
and privacy text resolve through the catalogue; some dynamic status messages remain
English. Module SSR renders Preferences too (vitest 13). Remaining bodies: Studio,
MIDI (plus preset data and dynamic messages).

## Thirty-sixth batch: shell resume card

The session bar shows **Resume: <title>** for the most recently played library song
when no file is active. Clicking it asks the session for that song and focuses the
Library, which opens it and clears the pending id. `mostRecentSong()` is a pure
helper with tests (player Node tests 39).

## Thirty-seventh batch: analysis lane toggles

The Analysis timeline can hide key/tempo, chords and beats independently; the
choice persists in `neiro.analysis.lanes` and defaults to all visible. The SSR test
asserts the three lane labels (vitest 14).

## Thirty-eighth batch: About quick start and What's new

About now has a four-step Quick start and a 1.2.1 feature list (player/render,
library/resume, companion, installers). SSR asserts both sections (vitest 15).
Guided tours and support links remain open on T-71.

## Thirty-ninth batch: cache-budget contract fix (the "flake" was real)

`prefs_snapshot` returned `cache_budget_effective_gb` rounded to 2 decimals while
the cache used `int(effective * 1e9)` bytes. On a machine with enough free disk the
budget is not clamped (effective == requested 20 GB), so rounding happened to match;
with ~9 GB free the budget is clamped (~4.81 GB) and the test's equality check
failed. The API now also returns `cache_budget_effective_bytes`, the cache uses that
exact value, and the test compares bytes (with a display-rounding tolerance for the
GB field). Full gate: 23/23.

## Fortieth batch: deterministic low-disk regression

Added `test_effective_cache_budget_is_clamped_to_free_disk`, which monkeypatches
`shutil.disk_usage` to 2.01 GB free and requests a 1.5 GB budget. It pins the exact
byte value (1,004,999,999 due to float truncation), the rounded display value, the
cache's bytes, and the fact that the display field no longer equals exact bytes —
the condition the old test silently depended on.

## Forty-first batch: render job over HTTP

`test_render_job_over_http_serves_audio` uploads a 0.5 s tone, posts
`/api/edit/job` with `{op: render, rate: 0.5, semitones: 12}`, polls
`/api/job/<id>` until done, checks the ~0.25 s duration and `render(...)`
provenance, then downloads `audio_url` and asserts a non-empty 200 response. This
exercises the token/API/worker/artifact path used by the player's Render button.

## Forty-second batch: MIDI Studio shell catalogue

MIDI Studio's gate, header, mode-tab aria label and empty-roll state resolve through
the catalogue; mode labels/hints and body controls remain data/English. SSR renders
the empty gate (vitest 16).

## Forty-third batch: Studio compact mode

A Compact toggle in Studio collapses lane heights (2.25 rem; 4.5 rem with
spectrogram) and persists in `neiro.studio.compact`. This is the compact part of
T-67; "wide" remains an extension limitation and is not promised. No automated UI
test (Studio needs a full session); build + typecheck cover it.

## Forty-fourth batch: final documentation sync

HANDOFF §14, the worklist closure assessment and AUDIT §13.6 now match the tree:
278 Python tests, 39 player tests, 16 vitest tests, 47 addon checks, clean Rust
toolchain, installers with the bundled engine, and the catalogued surfaces. The
closure assessment separates what is done from the five owner/toolchain-gated gaps.

## Forty-fifth batch: Authenticode signing pipeline

Added `scripts/sign_windows.ps1` (PFX + password from env, timestamp with fallback,
signature status report). Verified on both existing bundles with a temporary
self-signed code-signing certificate (created, used, then removed; PFX deleted):

```
MSI   signed, timestamped=True, status=UnknownError, signer=CN=Neiro Dev Signing
NSIS  signed, timestamped=True, status=UnknownError, signer=CN=Neiro Dev Signing
signtool verify /pa -> exit 1: chain terminates in an untrusted root
```

That is the expected result for a dev certificate: signature and timestamp are
present, only public trust is missing. A release reruns the same script with an
OV/EV certificate; updater keys/endpoint and the clean-VM test remain owner steps.

## Forty-sixth batch: blind ABX listening panel

`abx.ts` (balanced trials, injectable RNG, scoring, summary) + `AbxPanel` wired to
the rendered artifact. A is original, B is rendered, X is hidden; 10 trials at a
fixed offset with 4 s excerpts, reveal, "can't tell", and accuracy over decided
trials. Unit tests (3) cover balance, determinism, scoring and summary; SSR checks
the controls. Player Node tests 42; this is a discrimination test, not an owner
preference verdict.

## Forty-seventh batch: Studio per-stem granular transpose

Every Studio stem now passes through a per-track `AudioWorkletNode`
(`neiro-stem-shift`, the tested clean-room granular kernel) before gain/pan, loaded
once per context from a blob URL. A persisted Transpose control (-12…+12) applies
to all stems; media elements stay at 1× so the master clock is untouched. Bypassed
at 0. Preview-grade (formants follow pitch; no per-stem speed/formant/EQ) and
labelled as such in `docs/player.md`.

Fixing the kernel to pass tests found a real bug: the fractional ring index
(`ring[float]`) returned `undefined` → NaN/Inf after the first shifted sample. The
tap is floored now, in both the Studio and companion copies; a non-bypass
finite-output test covers it. Player tests 44; companion worklet tests 6.

## Forty-eighth batch: Studio preview speed with pitch correction

Speed 0.5–2× sets each stem's `playbackRate` (browser `preservesPitch` disabled) and
the granular shifter applies `-1200·log2(speed)` cents plus transpose, restoring
pitch while tempo changes. The master clock is multiplied by the same speed and
rebased at the current playhead on change, so the playhead, A–B and lock stay
coherent. Combined-ratio test: +12 st with speed 2× → ratio 1. Preview-grade and
documented; phase-vocoder quality/formant/EQ in Studio remain open.

## Forty-ninth batch: real-browser worklet verification

Added a Playwright/Chromium check (`frontend/tests/browser-worklet.mjs`,
`npm run test:browser`) that renders through a real `OfflineAudioContext`:

- stem shifter at +12 st: 880 Hz dominates 440 Hz by ~16.7×;
- player at 2× speed: 440 Hz dominates 880 Hz by ~22× (pitch preserved);
- player at +12 st: 880 Hz dominates 440 Hz by ~26×.

To make the player test deterministic, the processor now accepts an initial
buffer/params via `processorOptions`, avoiding a message race before the first
`process()` call. Node kernel tests remain; this adds the missing real-runtime
evidence. Quality/listening and device latency remain owner-run.

## Fiftieth batch: companion extension e2e and two real fixes

Playwright/Chromium loads the unpacked MV3 extension, points it at a
**dynamic-port** engine, saves the URL, pairs with the code, checks health, and
uploads a WAV; the engine returns “A minor”. Receipt:
`docs/evidence/extension-e2e-2026-10-21.md`.

Bugs found and fixed:

1. the companion hardcoded `127.0.0.1:8377`, incompatible with the new dynamic port —
   the panel now stores a validated loopback Engine URL and Prefs shows the origin;
2. queued upload sent an `ArrayBuffer` through `chrome.runtime.sendMessage`, which
   is JSON serialized (`{}` → “empty upload”); the panel now POSTs directly with the
   stored token.

Tab capture/site adapters remain owner-run (side panel + permission gesture).

## Fifty-first batch: fractional-tap interpolation

The granular kernel's ring reads now linearly interpolate between taps. Integer
pitch ratios (e.g. +12) were already sample-aligned; fractional ratios (+7,
ratio 1.498) previously read the nearest sample. Chromium measurement for +7 st:
target 659.3 Hz magnitude 0.00711 vs 440 Hz 0.00071 (~10×), finite output, and the
existing +12/2× cases are unchanged. Companion and Studio copies share the fix.

## Fifty-second batch: always-open player preference

Prefs gains an opt-in **Open the player after import** toggle
(`neiro.prefs.openPlayerAfterImport`). The shell routes a newly imported file to
Practice once when it is enabled and the user is on Import; it does not steal focus
on later module switches. SSR asserts the toggle.

## Fifty-third batch: Studio layout scenes

`studio/scenes.ts` + Studio controls save/apply/delete up to 20 named scenes
(track mix gain/pan/mute/solo by id, view window, loop, transpose/speed) in
localStorage. Storage is validated against hostile/malformed data; applying only
changes matching tracks and preserves unknown ones. Four Node tests; player Node
tests 49.

## Fifty-fourth batch: Tauri updater pipeline

Added `tauri-plugin-updater` (registered + capability), a minisign keypair outside
the repo (`~/.neiro-updater/`), the public key and GitHub `latest.json` endpoint in
config, and a release-only config that enables updater artifacts. A signed build
produced `Neiro_1.2.1_x64-setup.exe.sig` and `…msi.sig` (416 B each); the new
`scripts/updater_manifest.py` generated `latest.json` with that signature and the
release URL. Two tests cover manifest shape and missing-artifact errors.

Normal builds remain key-free; publishing assets, a trusted Authenticode
certificate and a clean-VM update test remain owner steps.

## Fifty-fifth batch: consolidated acceptance run

Ran the gate and every optional browser/companion check in one pass; results are in
`docs/evidence/acceptance-2026-10-21.md` (23/23, 280 Python, 49 player, 17 vitest,
Chromium worklets, extension pairing/upload, 47 addon checks, updater manifest).
The same run lists exactly what remains unproven.

## Fifty-sixth batch: updater signature verified in Rust

Added `minisign-verify` + `base64` dev dependencies and a Rust unit test that
unwraps the base64-wrapped pubkey/`.sig`, verifies the NSIS installer against the
committed public key, and skips when release artifacts are absent. `cargo test
--lib` passes and is now part of gate C23, so future signed builds are checked
cryptographically, not just for file existence.

## Fifty-seventh batch: desktop updater UI

About now calls the Tauri updater when running inside the shell: check, show the
available version, download/install with progress, and relaunch via the process
plugin; the browser path keeps the GitHub Releases check. Rust registers
`tauri-plugin-process` and adds `process:allow-restart`. The non-Tauri bridge is
unit-tested; desktop runtime remains owner-run, as does publishing/hosting.

## Fifty-eighth batch: desktop updater runtime + two shell bugs

Added `npm run test:desktop-updater`: launch the release exe with WebView2 remote
debugging, connect Playwright over CDP, open About and click Check for updates. The
UI now reports “Updater check failed (Could not fetch a valid release JSON from the
remote)” — proof the plugin ran through Tauri IPC (the browser fallback fails the
test).

Fixed while verifying:

1. **No IPC on the UI origin.** An `about:blank` window navigated to the engine did
   not expose `__TAURI_INTERNALS__`; the window is now built with
   `WebviewUrl::External` and the capability grants `remote.urls =
   ["http://127.0.0.1:*"]`.
2. **Stale bundled engine.** `target/release/resources/engine` from an earlier
   build served an old UI. `build_sidecar.py --install` now cleans/re-stages, and
   the release notes require removing `target/release/resources` first.

## Fifty-ninth batch: updater success path needs HTTPS

Tried to exercise the “update available” path against a local manifest. Tauri's
updater refuses non-HTTPS endpoints at startup
(`PluginInitialization("updater", "… must use a secure protocol like https")`), and
the test binary exited before creating a window. The normal build was restored and
the CDP runtime check still passes (Tauri IPC, no-release error surfaced).

Recorded in `docs/packaging.md`: the success path needs a real HTTPS release; no
local http stub can validate it. The manifest format itself is covered by tests and
the signature by Rust C23.

## Sixtieth batch: updater success path verified (dev flag)

A dev-only build (`dangerousInsecureTransportProtocol: true` in an override config,
local manifest endpoint) was driven over CDP: About → Check for updates shows
**“Update available: 1.2.2.”** This proves manifest parsing, version comparison and
the offer UI. The production config was restored (HTTPS, flag absent) and the
runtime check still passes with the no-release error. The dangerous flag is
documented as test-only and never committed to the config.

## Sixty-first batch: bake preview settings into stems

Studio gains **Render stems**: confirm, pause, then run each track through the
engine `render` op with the current transpose/speed, poll the jobs, replace the
track artifact (keeping the original id for Reset), and reset the preview controls.
`studio/render.ts` maps/clamps rate and semitones and is unit-tested; player tests
51.

## Sixty-second batch: companion site-access diagnostics

The panel shows the active http(s) origin and optional host-permission state, with a
click-driven **Grant this site** request (required by adapters on streaming sites).
Validator 48/48 and the dynamic-port pairing/upload e2e still pass.

## Sixty-third batch: desktop shell smoke

`npm run test:desktop-smoke` launches the release exe with WebView2 remote
debugging, connects over CDP, and visits all nine rail modules (Import, Analysis,
Studio, Separate, Restore, MIDI, Library, Prefs, About). Result: every module
renders its expected heading and **zero page errors**.

## Sixty-fourth batch: desktop workflow end-to-end

`npm run test:desktop-workflow` drives the packaged shell: it sets a generated WAV
on the real Import file input, waits for the session to show `flow-tone.wav`, opens
Analysis and confirms report text (BPM/key/LUFS), then opens MIDI/player. Result:
**0 page errors**, “import → analysis → player” passes. This exercises the API,
analysis and session together, not mocked components.

## Sixty-fifth batch: MIDI Studio body catalogue

Catalogued the score pane, roll option labels (quality/mode/model/ensemble/decoders),
partial-snap title, PDF/score fallbacks, and the practice panel gates/toggles.
Option data (mode names, instrument lists) remains English. Studio is the last
uncatalogued module body.

## Sixty-sixth batch: Studio per-stem 3-band EQ

Each track graph now runs shifter → low shelf (200 Hz) → peaking (1 kHz) → high
shelf (6 kHz) → gain → pan. Three ±12 dB sliders sit beside gain/pan; values apply
live (applyVolumes depends on tracks) and round-trip through Studio scenes.

## Sixty-seventh batch: ad-wait actually enforced

The panel used to display “ad playing — capture waits for media” but Start still
captured. Start now queries the adapter media state and refuses while `ad` is true,
showing “ad playing — wait for the show to resume.” Validator checks the guard;
pairing/upload e2e is unaffected.

## Sixty-eighth batch: release-candidate packaging run

Rebuilt the sidecar clean, cleared `target/release/resources`, and produced MSI
(58.1 MB) + NSIS (39.8 MB) with updater signatures and a valid `latest.json`.
Administrative MSI extraction contains the bundled engine; launching the extracted
app with **no Python on PATH** spawned `neiro-engine.exe` and opened the Neiro
window. Details: `docs/evidence/release-candidate-2026-10-21.md`.

## Sixty-ninth batch: Studio chrome catalogue

Headings, tool-group labels and the transport/tool/view/clip aria labels now
resolve through `studio.*` via a `tr = useT()` alias (avoiding the `t` track
variable). Tooltips, the help sheet and dynamic messages remain English and are
documented as such.

## Seventieth batch: Studio tooltips catalogue

Transport, tools, track actions, scenes/render, Mute/Solo/Gain/Pan and mix actions
now have localized tooltips through `studio.*`. The help sheet, dynamic status
messages and unicode-dash titles that could not be matched cleanly remain English
and are documented as such.

## Seventy-first batch: minimal loopback IPC capability

Split the remote capability out of `default.json`: the engine-served loopback origin
now gets only `updater:default` and `process:allow-restart`, not the broad
`core:default` set. The updater runtime check, nine-module smoke and import →
analysis → player workflow all still pass, so the minimal set is sufficient.

## Seventy-second batch: remaining Studio tooltips

Stop/Fit/Pitch-correct/Loop/BPM/Reset/Mix-drawer tooltips (including em-dash and
arrow strings) now resolve through `studio.*`. Studio tooltips/aria are complete;
the help sheet and dynamic messages remain the only English chrome.

## Seventy-third batch: CSP on the served UI

HTML documents now carry a restrictive Content-Security-Policy (same-origin
scripts, self/blob worklets, same-origin media, no objects/framing, inline styles
allowed for React). A header test was added; the desktop workflow and Chromium
worklet checks pass under it. `SECURITY.md` documents the directives.

## Seventy-fourth batch: security headers

All responses now send `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer`, `X-Frame-Options: DENY` and a Permissions-Policy denying
geolocation/camera/microphone/payment/USB. The CSP test asserts the headers; the
desktop workflow still passes.

## Seventy-fifth batch: CI and release workflows brought up to date

CI gained player DSP tests, an addon validator/worklet job, and Rust
fmt/clippy/check/unit tests; the duplicated rust key introduced while editing was
merged and the workflow parsed. Release now installs PyInstaller, stages the
model-free sidecar, uses the signed release config only when signing secrets exist,
emits `latest.json`, and uploads `.sig`/manifest assets. `build_sidecar.py` now
renames `neiro` → `neiro-engine` on non-Windows too.

## Seventy-sixth batch: current parity summary

Added AUDIT §13.7: a conservative, evidence-linked summary of which matrix rows are
implemented, partial, N/A or owner-gated as of 2026-10-21. HANDOFF §14 counts were
refreshed (281 Python, 51 player, 17 vitest, 49 addon). No row is called complete
without a commit or receipt.

## Seventy-seventh batch: RTL direction plumbing

`dirFor()` maps ar/fa/he/ur to rtl; the provider now sets `<html lang>`/`dir` and
the helper is unit-tested. No RTL catalogue ships and CSS is not mirrored, so this
is infrastructure, not an RTL-ready claim.

## Seventy-eighth batch: plural selection

`translatePlural`/`usePlural` implement `Intl.PluralRules` selection with an
`other` fallback; queue/song counts use it in Import, Library and Separate. Tests
cover one/other/zero/fallback. Only English rules are exercised until another
catalogue ships.

## Seventy-ninth batch: Studio help and messages

The Studio help sheet (kbd labels preserved), lead text, timeline note, About
shortcut link and the render confirm/progress/done/failure messages now resolve
through `studio.*` / plural selection. Studio is fully catalogued in English;
non-English catalogues and mirrored RTL CSS remain the open i18n work.

## Eightieth batch: final release-candidate rebuild

Rebuilt the current tree (post-i18n/CSP/CI): MSI 58.3 MB + NSIS 39.9 MB with
updater signatures, manifest generated, signature verified by `cargo test --lib`,
and the extracted app launched with no Python on PATH spawning the bundled engine.

## Eighty-first batch: end-to-end QA sweep and UI fixes

Added a real-engine Playwright sweep (`frontend/tests/desktop-flows.mjs`) and a
per-module axe/overflow sweep (`desktop-qa.mjs`). Fixed theme startup, rail
accessible names/contrast, the dropzone control, modal Escape ownership and job-tray
click-through. See `docs/evidence/qa-sweep-2026-10-22.md`.

## Eighty-second batch: cancel, playlist and tray fixes

Cancel now authenticates (was 401), playlist add refreshes the count, the queue
message no longer miscounts, and the collapsed job tray can be reopened after the
click-through fix. Extended flows cover all Restore/Separate presets, session
save/open/export/new, multi-file queue, MusicXML export and tray hide/show.

## Eighty-third batch: select-drag, edit ops and stem paths

The clip body swallowed select-drags and moved the clip in every mode; Select now
starts a region selection there (Move tool still moves). Verified fade/gain/
normalize/reverse/trim (8.0 s clip → 3.2 s), Restore → Studio and Separate → mashup
pack with stems present.

## Eighty-fourth batch: About/Prefs honesty and stale-sidecar note

The engine UI no longer fetches GitHub (CSP-blocked) for update checks; it says the
updater lives in the desktop app. Prefs shows the effective cache budget and free
disk, and the oversize rejection is visible. Documented that desktop UI
verification requires rebuilding the sidecar (the packaged UI lives inside it).

## Eighty-fifth batch: backend CLI sweep and desktop regression

Added `frontend/tests/backend-cli.mjs` (`npm run test:backend`): analyze,
transcribe, enhance and separate with output assertions. Rebuilt sidecar + desktop
and re-ran smoke, workflow, updater IPC, companion e2e, worklets and addon
validation; fixed the workflow's stale rail selectors found by the regression.

## Eighty-sixth batch: open-player preference and resume

Import now honours “Open the player after import” by switching to MIDI practice and
focusing it (it previously only set a flag no mounted module consumed). Verified
practice playback after import and Library “Resume: song” after a reload.

## Eighty-seventh batch: track header width and tray auto-collapse

Track heads widened so stem badges are readable, and the job tray collapses to its
edge pill once the jobs that opened it finish (it was covering the Mix drawer).
Flow idle detection now treats a collapsed tray as idle.

## Eighty-eighth batch: final QA suite (14 checks)

Gate, desktop smoke/workflow/updater, packaged and light/1024 axe sweeps, 19-step
user flows, resume/preference, packs, companion e2e, worklets, backend CLI and the
addon validator all pass on the rebuilt package.
