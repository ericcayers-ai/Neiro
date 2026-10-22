# Neiro handoff - 2026-10-20

> **Status banner.** This is the first canonical Neiro handoff; no prior
> `HANDOFF*.md` was found in the repo. It supersedes the stale planning claims
> in `README.md` (1.1.1), `docs/session.md` ("UI not wired"), `SECURITY.md`
> ("pre-1.0"), and the behavioural reading of `docs/roadmap-traceability.md`.
> It is **not** a second work list: the evidence and the full parity/port plan
> are in [`docs/AUDIT.md`](docs/AUDIT.md). Read this brief for the operating
> order, then use the audit as the ledger.
>
> **One-line brief:** preserve the dirty fix, make the claims true, build one
> shared real-time player, keep the Python engine as the queued quality path,
> then add the optional companion. Do not start by cloning Transpose's UI.
>
> **2026-10-20 update:** this brief was executed; see §14 for the implementation
> status, the gate result, and the remaining items.

---

## 1. Objective and role

Act as the senior audio-app engineer/architect for **Neiro**
(`C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant`), not Neutral and
not the `learning-studio` bridge.

The owner wants:

1. A Neiro handoff (this file) and a remade audit (`docs/AUDIT.md`) covering all
   missing features, gaps, stubs, and bugs.
2. A plan to port **every capability** of the Transpose Chrome extension
   (`ioimlbgefgadofblnajllknopjboejda`, v6.5.4) into Neiro.
3. An **optional** browser-extension addon that can run the app/player in a
   browser.
4. Both **real-time** interaction and **queued** processing for quality.
5. A clean-room reimplementation: no copied proprietary code, assets, locale
   strings, model CDN artefacts, or `rb.wasm` (Tune73 commercial).
6. Preservation of the existing uncommitted work (especially the
   `pitch_correct` fix).

"Port everything" means **capability parity**. It does not mean copying the
commercial account/cloud/subscription funnel. That conflict is an owner
decision, not an implementation detail; see §9.

---

## 2. Ranked optimising order (and the conflicts)

### Order

1. **Truth, regression safety, and security.** Commit the dirty `pitch_correct`
   fix with a test; fix the auto-enhance no-op, session-notes schema, CI lint,
   `verify_models`, CORS/CSRF/upload/plugin consent; make the practice/analysis
   labels honest. This unblocks every later claim.
2. **One shared real-time player.** Web Audio + AudioWorklet + clean-room WASM
   DSP; A-B/count-in; pitch/speed/formant/EQ/reducer; migrate MIDI Practice and
   Studio. This is the largest Transpose gap.
3. **Practice and library data.** Markers, clips, sequences/ramp, scenes,
   SQLite library, playlists, versions, notes, auto-save, MIDI learn. This is
   what makes the player feel like Transpose rather than a demo.
4. **Real analysis.** ChordMini/BTC- and Beat This-class models behind
   optional manifests; confidence/no-result; chord/beat timeline. Replace the
   one-global-chord/fixed-4/4 claims.
5. **Optional Neiro Companion addon.** MV3 side panel, offscreen tab capture,
   site adapters, pairing/token, standalone RT, queued Neiro handoff.
6. **i18n, accessibility, packaging, quality evidence.** 55 locales is a
   program; a signed standalone installer and full corpora are release work,
   not a first sprint.

### Conflicts to name explicitly

| Conflict | Resolution |
|---|---|
| "Port every feature" vs local-first privacy | Accounts/cloud/subscription/share/3-slot limits are **not** local-first features. Do not port them unless the owner opens a separate product decision. |
| Real-time convenience vs audio quality | Two modes: **Preview** (low latency, WASM) and **Rendered** (queued Neiro, high quality). Never call a phase-vocoder preview "pitch-preserving" or "Rubber Band". |
| Core app vs addon | Core player/library first; the addon reuses the SDK. The addon must be optional; Neiro works without it. |
| Rubber Band quality vs licence | `rb.wasm` is Tune73 commercial. Prefer a verified MIT stretcher (Signalsmith candidate) or a clean-room WSOLA/PSOLA/phase-vocoder. Use SoundTouch (LGPL) only with compliance. |
| Model parity vs this machine | 70 registered / 16 ready; 4 GB free at audit start, 7.7 GB immediately after cleanup, 4.6 GB later; default cache 20 GB. No multi-GB installs without explicit consent and a disk preflight. |
| Fast ship vs standalone packaging | The current Tauri shell needs system Python and a fixed port. A real release needs a bundled sidecar, dynamic port, signing, and updater. Do not call it standalone before that. |
| "Verified" vs actual | The traceability ledger is structural. 192/206 `verified` is not behavioural evidence. Use tests, live probes, listening receipts. |

**If forced to choose:** Phase 0 (truth/security) and Phase 1 (player) first.
A perfect addon on top of false claims is worse than a smaller, honest app.

---

## 3. Starting state: verified facts

### 3.1 Repo, release, worktree

- Repo: `C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant`
- Branch/commit: `main` / `c3cc5c0` (merge release/1.2.1)
- Tag: `v1.2.1`; package/API: `neiro 1.2.1`, API 1
- Python: `.venv` 3.13.14; `pyproject >=3.10`; README 3.10-3.12; CI
  3.10-3.12; launcher 3.10/3.11/3.12
- Frontend: React/TypeScript/Vite, `frontend@1.2.1`; CI Node 22
- Desktop: Tauri 2.11, fixed port 8377, spawns system Python
- Dirty worktree: **preserve it**. Modified: `.gitignore`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, `pyproject.toml`, `scripts/live_install_test.bat`,
  `src/neiro/ui/server.py`; deleted `src/neiro/ui/static/icons.svg` (no
  references found; safe cleanup). Untracked: `.cursor/`, `.gitattributes`,
  `.graphify/`, `.graphify_claude_hook_installed`, `.graphify_hook_installed`,
  `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `skills-lock.json`.
- The dirty `server.py` change is the **`pitch_correct` progress fix**. Do not
  revert or refactor it before committing it with a regression test.

### 3.2 Live engine

- `/api/health`: `ok`, 1.2.1, `python-sidecar`.
- `/api/version`: name `neiro`, API 1.
- Models: **70 registered, 16 ready** in the API view; `verify_models` shows
  20 DSP entries live-tested and all neural deferred.
- CPU only, 16 GB RAM; no accelerator; no GPU.
- `/api/tools`: Verovio, MuseScore, soundfont all absent.
- `/api/plugins`: empty.
- 4 s probe results: upload works; separate `vocals` -> `dsp-center`, 1.96 s,
  3 files; pitch-correct 6.8 s (fix works); auto-enhance **done with empty
  chain/no file**; time-stretch 6.91 s (`phase-vocoder`); pitch-shift 0.7 s
  (`pv+resample`); session save/open works but string notes become a character
  list; ingest URL 422 (no yt-dlp).
- CORS preflight 501; no `Access-Control-Allow-Origin`; a `text/plain` JSON
  body is parsed (CSRF surface); path traversal probes fail safely.
- `neiro analyze`: 1 chord / 2 downbeats / 1 section on the probe.
- CLI analyze/separate/transcribe/enhance/session/watch all execute; auto
  enhance prints "No file written"; `normalize` writes.
- Tests: **220 collected, 219 passed, 1 skipped** with
  `pytest -q -m "not slow" --basetemp C:\np`; default pytest temp fails its own
  Windows cleanup after passing.
- `ruff check .` passes; **`ruff format --check .` fails** on
  `docs/adding-models.md:40` and `docs/session.md:26`; CI runs it.
- Frontend `tsc` and `vite build` pass; `oxlint` passes with warnings; no
  frontend test script.
- `cargo fmt --check` passes; `cargo check`/clippy not run locally (no target,
  disk was tight).
- `verify_models.py` locally reports 70/70 failures because it calls `neiro`
  on `PATH`; the venv's `Scripts` dir is not on `PATH`.

### 3.3 Environment / disk

- 4 GB free at audit start; 7.7 GB immediately after removing audit temp data;
  3.8-4.6 GB later (final check 3.8 GB). The volume is volatile; treat <8 GB as
  tight.
- Default cache budget: **20 GB**; no disk preflight.
- Rubber Band, yt-dlp, websockets, Verovio, MuseScore, SF2 absent.
- No `pip` in the uv-managed venv; audit installed `pytest`/`ruff` with
  `uv pip`, then removed `frontend/node_modules` and `C:\np` test data.
- Don't assume the model zoo is usable. The DSP floor is; neural is not.

### 3.4 Extension baseline

- Transpose 6.5.4, MV3, min Chrome 127, 332 files / 37.4 MB.
- UI strings: 35 groups, 512 first-level entries, **802 recursive leaves**;
  55 locales / 110 i18n files.
- Permissions: `activeTab`, `contextMenus`, `offscreen`, `scripting`, `storage`,
  `sidePanel`; optional `tabCapture`; optional host access.
- Core surfaces: side panel, popup, offscreen stem/player, tab capture, content
  scripts, service worker, `externally_connectable`.
- DSP/models: `aw-tp-processor.js`, `stem-offscreen.js`, `rb.wasm` (commercial),
  UMX-HQ / ChordMini-BTC / Beat This / Musetric / ONNX Runtime Web /
  SoundTouchJS. See `THIRD_PARTY_NOTICES.txt`.
- Features: real-time transpose/pitch/speed/formant/varispeed/vocal reducer/EQ;
  A-B/count-in/markers/clips/ramp/scenes; library/playlists/notes; MIDI learn;
  site adapters/tab capture; accounts/cloud/subscription (paid);
  55 locales.
- Static inspection only: no live site/tab-capture/WebGPU/model/account test.

### 3.5 What already works (do not regress)

Separation/restoration/transcription; Studio timeline/Mix/A-B/null/spectrogram;
MIDI Studio score/roll/practice (but see audit F-01-07); VST2 capture; CLI/API;
session provenance; local privacy; themes; command palette; 219 tests; frontend
build; Rust fmt.

---

## 4. Eliminated hypotheses

These were checked and are false or stale. Do not re-litigate without new
evidence.

| Hypothesis | Verdict |
|---|---|
| "Neiro cannot run on this machine." | **False.** Health `ok`, 1.2.1, 70 models/16 ready, API/CLI jobs run. The earlier conclusion was likely a model/disk/install impression. |
| "The traceability matrix proves the features work." | **False.** 192/206 `verified` is keyword/file structural matching. R-0038/39/40/87 are contradicted by `analysis/report.py` and `MidiPracticePanel.tsx`. |
| "Practice mode has loop regions, count-in, and wait." | **False.** Whole-file `<audio loop>`, dead `countIn`, wait counter without pausing audio; speed is 25-200% offline. |
| "Rubber Band powers practice speed." | **False locally.** No `rubberband` binary; time-stretch provenance is `phase-vocoder`; pitch-shift is `pv+resample`; UI ignores provenance. |
| "Neiro has chord/beat analysis." | **Partial at best.** One global chord from six templates; fixed 4/4 downbeats; energy sections; none displayed in the Analysis UI. |
| "Session save/open is missing." | **False.** UI, API, CLI all save/open. The unwired part is free-text notes (and the schema is wrong: a string becomes a character list). |
| "The Tauri app is standalone." | **False.** It spawns `python` from `PATH` on fixed port 8377; no externalBin/sidecar; PyInstaller spec is separate; installer unsigned. |
| "CLAP/VST3 is production." | **False.** `plugins/neiro-clap` is a stub/placeholder; VST2 (`neiro-vst`) is the production bridge. |
| "Loopback means CSRF/CORS is safe." | **False.** No CORS, but a simple `text/plain` POST is parsed and mutates state; uploads have no cap. |
| "The model zoo is ready." | **False.** 16/70 ready; no torch/onnx/audio-separator; no GPU; disk 4-7.7 GB vs 20 GB cache and multi-GB models. |
| "Neutral is in scope." | **False.** No Neutral source or deliverable was edited; it is out of scope. |
| "learning-studio/neiro-bridge is part of Neiro." | **False.** It is a separate consumer/contract; cite it, do not edit it. |
| "Transpose was executed for this audit." | **False.** Static inspection of 332 files/UI strings/notices only. |

---

## 5. Where the truth lives

### Primary

- **[`docs/AUDIT.md`](docs/AUDIT.md)** — measured findings, full extension
  ledger, parity matrix, port plan, verification receipt. This brief is a
  summary/operating order; the audit is the evidence.
- **`docs/roadmap-traceability.md`** — structural ledger only. A banner now
  says `verified` is not behavioural. Do not use it alone.
- **`docs/ui.md`** — useful module/feature map and the honest follow-ups list
  (full Verovio polish, signed index, plugin sandbox, full MUSDB tables,
  in-app watch panel). Some lines are stale (Simple/Advanced).
- **`docs/models.md`** — 70-model roster, tiers, licence caveats; not legal
  advice.
- **`docs/evaluation.md`** — synthetic CI gate + opt-in corpora; does not
  prove competitive quality.
- **`docs/performance.md`** — offline DSP RTF; "every stage real-time-capable"
  refers to processing, not the player; perf CI is not blocking.
- **`docs/session.md`** — session schema; its "UI not wired" line is stale.
- **`SECURITY.md`** — local-first intent; stale version table, no browser-CSRF
  section.
- **`README.md`** — install/feature overview; version 1.1.1, Python range, and
  Learn claims are stale.

### Source map

| Area | File |
|---|---|
| HTTP routes/jobs/uploads/edits | `src/neiro/ui/server.py` |
| Sessions/notes/plugins/tools/DAW | `src/neiro/ui/api_extras.py` |
| Planner/presets | `src/neiro/engine/planner.py` |
| Model registry/manifests | `src/neiro/engine/registry.py`, `src/neiro/manifests/` |
| Time-stretch/pitch | `src/neiro/dsp/edit.py` |
| Analysis/chords/sections/downbeats | `src/neiro/analysis/report.py` |
| Practice UI | `frontend/src/modules/midi/MidiPracticePanel.tsx` |
| Studio/Mix/A-B | `frontend/src/modules/StudioModule.tsx` |
| Analysis UI | `frontend/src/modules/AnalysisModule.tsx` |
| Session menu | `frontend/src/shell/AppShell.tsx` |
| API client | `frontend/src/api/client.ts` |
| Tauri shell | `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json` |
| Packaging | `packaging/neiro.spec`, `packaging/launchers/`, `packaging/build_release.py` |
| VST2/CLAP | `plugins/neiro-vst/`, `plugins/neiro-clap/` |
| Extension | `C:\Users\ericc\AppData\Local\Google\Chrome\User Data\Profile 1\Extensions\ioimlbgefgadofblnajllknopjboejda\6.5.4_0` |
| Bridge contract | `C:\Users\ericc\OneDrive\Desktop\Programs\learning-studio\docs\NEIRO-BRIDGE.md` |

### Lookup-when-stuck rule

1. Use the graph before raw reads. `graft` is not on PATH; `graft/` cards are
   readable. `graphify` is installed (0.9.36) but its default graph path is
   `graphify-out/graph.json`; use:
   `graphify query "..." --graph .graphify/graph.json`.
2. The graph is from committed `c3cc5c0`; it does not include the dirty
   `server.py`. For the fix, read the worktree directly.
3. Open exact file:line spans from the audit; don't bulk-read 191 files.
4. Skills loaded for this work: `repo-handoff-briefs`, `gap-audit`,
   `writing-docs`; follow `using-superpowers` for any new task.

---

## 6. Working environment

```powershell
$repo = 'C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant'
Set-Location $repo

# Health / version
.\.venv\Scripts\neiro.exe --version
.\.venv\Scripts\neiro.exe models

# Engine (background)
.\.venv\Scripts\neiro.exe ui --no-browser --port 8380
Invoke-RestMethod http://127.0.0.1:8380/api/health

# Tests: ALWAYS use a short basetemp on Windows
.\.venv\Scripts\python.exe -m pytest -q -m "not slow" --basetemp C:\np

# Lint
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\ruff.exe format --check .   # currently fails on two docs

# Frontend (only if free disk > 3 GB)
npm --prefix frontend ci
npx --prefix frontend tsc -p frontend/tsconfig.app.json --noEmit
npx --prefix frontend vite build --outDir C:\np\frontend-dist --emptyOutDir
# remove frontend/node_modules and C:\np afterwards if disk is tight
```

Facts:

- `pip` is absent in `.venv`; use `uv pip` or `uv run`. Audit installed
  `pytest`, `pytest-cov`, `ruff` in the venv; they remain.
- No `node_modules` now (removed after the build).
- No Rubber Band/yt-dlp/Verovio/MuseScore/SF2; no torch/onnx; CPU only.
- Disk: 7.7 GB free immediately after cleanup, 3.8-4.6 GB later (final check
  3.8 GB); default cache 20 GB. Do not download models or install `[all]`
  without a disk plan.
- Cargo 1.97; no `src-tauri/target`; a full check/clippy/build will download
  and use significant disk.
- `graphify` warns skill 0.17.1 vs package 0.9.36 and pre-#1504 IDs; expect
  noise.
- `verify_models.py` is PATH-fragile; fix it to `sys.executable -m neiro.cli`
  before treating its local 70/70 failures as product failures.

---

## 7. Work ordered by what unblocks

### Phase 0 — Truth and safety (1-3 days)

1. **Commit the dirty `pitch_correct` fix** + a regression test that fails
   without it. Do not refactor `server.py` first.
2. Fix **auto-enhance no-op**: result must have `noop: true`/`reason` or a
   semantic error; never `done` with no artifact.
3. Fix **session notes** to a scalar 5,000-char field; add a round-trip test.
4. Fix **`verify_models.py`** PATH lookup; fix **`ruff format`** on the two docs;
   make CI green with the current ruff.
5. Close the **API security** holes: token, Origin/Host, require JSON
   Content-Type, body/upload caps, plugin/tool consent, SSRF policy; add CSRF
   probes to tests.
6. Make practice honest: remove/implement count-in, wait gating, proper A-B
   loop, and provenance labels; change "pitch-preserving stretch ready" to the
   actual method.
7. Make analysis honest: remove "lattice/transformer" claims until real models;
   expose `chord`/`downbeat` data only if the UI shows it; add confidence/no-
   result; update traceability banner/docs.
8. Update README/session/security/UI docs; add the traceability banner.

**Exit:** CI green; 220+ tests; security probes return 401/413/415 as designed;
no false claims; dirty work committed or explicitly backed up.

### Phase 1 — Shared real-time player (1-2 weeks)

- One AudioContext, AudioWorklet, clean-room WASM DSP (verify Signalsmith
  licence/formant; SoundTouch LGPL fallback only).
- Transpose/pitch/speed/formant/EQ/reducer/varispeed; A-B/count-in; wait gating;
  measured latency; provenance labels.
- Migrate `MidiPracticePanel` and Studio transport; preserve Mix gain/pan/A-B.
- Tests: audio null/click, loop timing, count-in, wait state machine, latency,
  long-file behavior, fallback.

**Exit:** a 4-minute song plays with <30 ms local control latency; no whole-file
wait for a speed change; A-B/count-in/wait actually work; method shown.

### Phase 2 — Practice and library (1-2 weeks)

- Markers, practice clips, sequences/ramp, scenes; SQLite library, playlists,
  versions, scalar notes, auto-save, migration, export/import.
- MIDI learn/mappings; keyboard customization; storage quotas/preflight.
- **Exit:** create/reopen a clip sequence with notes/markers; survives restart;
  no data loss; MIDI mapping persists; disk quota enforced.

### Phase 3 — Real analysis (1-2 weeks)

- ChordMini/BTC + Beat This-class manifests/adapters (MIT upstream), ONNX
  Runtime, confidence/no-result, chord/beat timeline.
- Keep DSP heuristics as labelled fallback; do not call them transformers.
- **Exit:** real fixture timeline; silence/noise returns "no reliable result";
  model optional; cache/disk tested.

### Phase 4 — Optional companion (2-3 weeks)

- MV3 side panel/offscreen/service worker; direct site adapters; generic
  fallback; tab capture; pairing/token; standalone RT; queued Neiro.
- **Exit:** YouTube/Spotify/SoundCloud e2e; no double audio; capture stop/
  revoke; no remote code; privacy/store docs; Q only when paired.

### Phase 5 — i18n, a11y, packaging (1-2 weeks)

- i18next/ICU, en + community; MIDI/a11y; sidecar/externalBin; dynamic port;
  installer/signing/updater; model manager.
- **Exit:** fresh Windows install without Python; signed; a11y receipt; locale
  smoke; no system-Python dependency.

### Phase 6 — Quality and release

- Full corpora where provisioned; listening panel; perf CI; license review;
  docs; release checklist.

**Do not start Phase 4 before Phase 1.** An addon on top of the broken practice
panel would duplicate the lies in a second surface.

---

## 8. Yet-to-consider decisions

| Decision | Recommendation | Why |
|---|---|---|
| Literal commercial parity? | **No**; local-first N/A for accounts/cloud/subscription/share/3-slot limits | Different product/legal/backend; conflicts with privacy. |
| Stretcher licence | Verify **Signalsmith Stretch** (MIT/formant) or clean-room; SoundTouch LGPL only with compliance; **never `rb.wasm`** | The extension's Rubber Band build is commercial. |
| Addon architecture | **Hybrid**: standalone RT + optional paired Neiro Q | Works without a server; quality when available. |
| Packaging | **Bundled sidecar**, dynamic port, signing/updater | Current system-Python shell is not a real install. |
| Library | **SQLite** with migrations, byte-bounded cache | JSON/session sprawl will not scale. |
| Analysis | **ChordMini/BTC + Beat This** MIT upstream, optional extra | Real chord/beat changes; confidence. |
| i18n | en first, then top community locales; 55 as a program | No copying Transpose strings; translation QA. |
| API security | **Token + Origin + Content-Type + caps** | Loopback does not stop browser CSRF. |
| Model/disk | Preflight, opt-in, sizes, signed index; no silent multi-GB | 7.7 GB immediately after cleanup, 3.8-4.6 GB later; 20 GB default cache. |
| Quality bar | Synthetic + listening + provisioned corpora + perf CI | No "verified" without a receipt. |
| Project boundary | `music-assistant` only; bridge is a consumer | Avoid scope creep and accidental edits. |
| Does the owner want the dirty work committed? | Ask; default preserve and commit the pitch fix with a test | It is essential and currently uncommitted. |

---

## 9. Boundaries

- **Do not copy** Transpose code, UI, images, locale strings, model CDN
  artefacts, or `rb.wasm` (Tune73 commercial).
- **Do not add DRM bypass** or protected-stream extraction. Tab capture is for
  permitted playback.
- **Do not port accounts/cloud/subscription/share/3-slot limits** without an
  explicit owner decision; they are not local-first features.
- **Do not edit the user's dirty/untracked work** without confirmation:
  `.gitignore`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `pyproject.toml`,
  `scripts/live_install_test.bat`, `src/neiro/ui/server.py`, `icons.svg`
  deletion, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.graphify/`, `.cursor/`,
  `skills-lock.json`.
- **Do not edit Neutral** or `learning-studio` for this port. The bridge is
  contract evidence only.
- **Do not download multi-GB models** or run `npm ci`/a full Rust build on a
  low-disk machine without checking free space and cleaning up.
- **Do not claim** "pitch-preserving", "Rubber Band", "real-time", "chords",
  "beats", "verified", "standalone", "CSRF-safe", or "CLAP/VST3" without the
  matching evidence.
- **Do not delete** audit/handoff docs or the traceability banner; they are the
  current truth baseline.

---

## 10. Method

- Use the `gap-audit` shape: static sweep, contract integrity, execution,
  rendered UI, tests. A reading pass finds only the surface.
- For every fix, write the failing repro/test first where feasible. The
  `pitch_correct` fix is the model: a live failure, a source fix, a regression
  test.
- Use the graph for orientation, then exact file:line reads. Do not trust
  generated `verified` rows.
- Audio work needs **listening + null/click/latency** evidence; automated
  tests alone do not prove quality.
- Clean-room: derive behaviour, not expression. Preserve upstream licences and
  provenance.
- Keep the Python engine as the quality path; the browser player is a preview/
  interaction layer, not a replacement for separation/restoration.
- When a claim is stale, fix the claim in the same change as the code, not a
  later docs pass.

---

## 11. Acceptance

A release candidate is acceptable only with:

- **CI:** Python tests (220+, including new contract/security tests) on the
  supported matrix; `ruff check` and `ruff format --check`; frontend lint,
  type-check, build; Rust fmt/clippy/check; `verify_models` via the correct
  interpreter.
- **API:** no CSRF/Origin/Content-Type bypass; body/upload caps; plugin/tool
  consent; auth token; path traversal; no wildcard CORS; auto-enhance no-op
  explicit; session notes scalar.
- **Player:** measured latency; A-B/count-in/wait; pitch/speed/formant/EQ/
  reducer audible and labelled; no click/zipper; fallback honest.
- **Queued:** stems/chords/beats/pitch-correct jobs with progress/cancel,
  cache, disk preflight; method/provenance shown.
- **Library:** create/edit/reopen/migrate/export; notes; markers/clips/scenes;
  no data loss; quota.
- **Addon:** real-site e2e; tab capture stop/revoke; no double audio; no remote
  code; privacy; Q only when paired.
- **Packaging:** fresh Windows install without Python; signed; updater;
  uninstall; model install/remove.
- **i18n/a11y:** locale smoke + RTL/plural; axe/keyboard/screen-reader receipt.
- **Docs:** README version/Python; session/security/UI claims; traceability
  statuses; no stale "verified".
- **Licences:** no `rb.wasm`; MIT/LGPL/unknown model review; notices.

A checklist without a command output, test, screenshot, measurement, or
listening note is not acceptance.

---

## 12. First 30 minutes (literal commands)

```powershell
$repo = 'C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant'
Set-Location $repo

git status --short
git log -1 --oneline
git diff -- src/neiro/ui/server.py pyproject.toml
Get-PSDrive C | Select-Object @{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}}

.\.venv\Scripts\neiro.exe --version
.\.venv\Scripts\neiro.exe models
.\.venv\Scripts\python.exe -m pytest -q -m "not slow" --basetemp C:\np
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\ruff.exe format --check .

# Read the evidence, not all 191 files
Get-Content docs\AUDIT.md -TotalCount 220
Select-String -Path docs\AUDIT.md -Pattern '^## |^### '

# Optional: graph query (the graph is from c3cc5c0, not the dirty fix)
graphify query "practice time stretch pitch shift analysis chords beats" --graph .graphify/graph.json --budget 3000

# Engine smoke, then stop it
.\.venv\Scripts\neiro.exe ui --no-browser --port 8380
Invoke-RestMethod http://127.0.0.1:8380/api/health
# Ctrl+C / close the process

Remove-Item C:\np -Recurse -Force -ErrorAction SilentlyContinue
```

Do **not** in the first 30 minutes:

- run `pytest` without `--basetemp C:\np` (cleanup exits 1 on long paths);
- run `verify_models.py` and conclude the models are broken (PATH bug);
- run `ruff format --check` and think the Python code is unformatted (it is
  docs code fences);
- run `npm ci`/cargo build without checking free disk;
- download models or install `[all]`;
- edit the dirty files or delete the untracked graph/config files;
- trust the traceability `verified` column.

---

## 13. First decision for the owner

Before implementation, get a written answer to these five:

1. **Scope:** local-first parity (recommended) or literal accounts/cloud/
   subscription/share parity (separate product)?
2. **DSP licence:** approve a verified MIT stretcher (Signalsmith candidate) /
   clean-room, with SoundTouch LGPL only as a compliant fallback?
3. **Addon:** hybrid standalone RT + paired Neiro Q (recommended)?
4. **Packaging:** bundled sidecar + dynamic port + signing/updater
   (recommended)?
5. **Dirty work:** commit the `pitch_correct` fix + regression test now, and
   preserve the rest?

Until those are answered, Phase 0 (truth/security/CI) is safe and unblocking.
Everything else can be sequenced behind it.

---

**Companion:** [`docs/AUDIT.md`](docs/AUDIT.md) - findings, full extension
ledger, parity matrix, port plan, verification receipt.

---

## 14. Implementation pass — 2026-10-20 (latest state)

The brief was executed across 78 goal rounds. The gate
`python scripts/verify_goal.py --full` reports **23/23 PASS**; the Python suite is
**287 passed / 3 skipped (290 collected)**; player Node tests **53**; vitest tests **17**; addon
validator **49/49**; `cargo fmt/clippy/check` pass; the frontend type-checks and
builds; MSI/NSIS installers build with the bundled engine. Receipts: `docs/evidence/{implementation,security,player-latency,a11y-static}-2026-10-20.md`.

### What changed

- **Phase 0 closed:** `pitch_correct` fix committed with a regression test; explicit
  auto-enhance no-op; scalar notes (5,000 cap, legacy migration); interpreter-safe
  `verify_models`; token/Host/Origin/JSON-type/body/upload/consent/SSRF/pairing
  security; CORS allowlist; disk-aware cache budget; CORS/CSRF probes tested.
- **Shared player:** clean-room phase-vocoder stretcher, resample pitch, cepstral
  formant warp, 6-band EQ, vocal reducer; A–B, count-in, metronome, wait gate,
  markers, clips, ramp, scenes; MIDI learn (note/CC) and remappable keyboard
  shortcuts; analysis overlay; sounding-A4 + tuner readout; compact mode; queued
  `render` of the current settings; honest method labels.
- **Practice:** runs on the player (no whole-file `<audio>`, no offline stretch, no
  dead count-in/false “pitch-preserving” claim).
- **Library:** SQLite songs/notes/markers/clips/scenes/playlists/versions; player →
  library marker/clip import; per-song player settings; resume/reset; local export;
  confirm-gated removal of cached model weights.
- **Analysis:** beat-synchronous chord timeline + onset-flux beat grid with
  confidence/no-result states and lanes in Analysis, the player and Studio. Still
  heuristic; no neural chord/beat model was installed.
- **Companion:** optional MV3 addon with loopback-only host permission, panel-side
  `tabCapture` request, engine health probe, site adapters, pairing and queued
  upload; 47 static checks + 5 worklet tests. Live-site e2e is owner-run.
- **Packaging:** `neiro ui --port 0 --port-file`; Tauri reserves a port, navigates
  after health, prefers a bundled engine; model-free PyInstaller sidecar (11 MB,
  verified standalone); MSI (56.0 MB) and NSIS (38.3 MB) installers build with the
  engine inside; extracted app launched with Python removed from PATH and opened the
  Neiro window.
- **i18n/a11y:** shell/navigation, player, Import, Library, Restore, Separate,
  Preferences and MIDI-shell catalogues with provider/fallback; static accessibility
  audit clean (36 files, 0 findings) plus an axe smoke on the player; docs for i18n,
  accessibility, packaging; third-party notices.
- **Later batches:** shell Resume card; analysis toggles; Studio compact mode,
  layout scenes, per-stem granular transpose/speed + 3-band EQ and queued stem
  render; blind ABX panel; library versions/per-song settings; MIDI/Studio
  catalogues; exact-byte cache budget (the apparent gate "flake" was real); HTTP
  render test; Chromium worklet checks; companion pairing/upload e2e with dynamic
  ports; site-access + ad-wait; updater plugin/UI + signed artifacts + latest.json;
  remote-IPC scoping; CSP/security headers; desktop smoke/workflow tests; CI and
  release automation.

### What is still not proven

Browser control-to-audio latency; listening/ABX quality; live-site capture and
revocation; **clean-VM** install (WebView2 preinstalled here); signed installers,
updater and uninstall; WCAG/axe and screen-reader passes; any neural chord/beat
model; a unified **per-stem** Studio engine; full i18n/RTL.

### Next actions (ordered)

1. Studio per-stem engine unification (a Real-time dialog already opens a track in
   the shared player and pauses the studio clock).
2. Neural ONNX chord/beat adapters with verified contracts, weights and no-result
   states.
3. Signing/notarisation, updater keys, clean-VM install and uninstall verification.
4. Extract module-body strings into the i18n catalogue; RTL/plural support;
   owner-run axe/screen-reader/contrast.
5. Companion live-site e2e and a listening panel.
