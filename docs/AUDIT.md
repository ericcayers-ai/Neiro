# Neiro audit and Transpose parity plan

> **Status: 2026-10-20.** This is the new canonical Neiro audit. No `AUDIT*.md`
> existed in the repository; the closest prior artefact was
> [`roadmap-traceability.md`](roadmap-traceability.md). This file is a remake of
> that audit for the current `main` + worktree, and it supersedes the
> *behavioural* claims in the traceability matrix while leaving that generated
> ledger in place. A one-line provenance banner was added to the ledger.
>
> **Scope:** Neiro (`music-assistant`) only. Neutral was not touched. The
> `learning-studio` `neiro-bridge` is a separate consumer of Neiro's API; it is
> cited only as contract evidence, not treated as part of Neiro.
>
> **Clean-room constraint:** the Transpose extension's code, assets, locale
> strings, and `rb.wasm` are **not** to be copied. The plan below is a
> feature-level reimplementation. Transpose 6.5.4 was inspected statically; it
> was not executed, and none of its model weights were downloaded.
>
> **Method:** static sweep, contract-integrity checks, live HTTP/CLI execution,
> frontend type-check/build, Python tests, and a source-to-claim comparison.
> Every finding below is labelled `[live]`, `[static]`, or `[not run]`. The
> verification receipt is in Part E.

---

## 0. Executive verdict

Neiro's foundation is substantially stronger than the audit question implies.
It runs, has a real local engine, a job system, a model registry, a capable
Studio, a serious CLI/API, a real VST2 bridge, session provenance, and 219
passing Python tests. The earlier "Neiro cannot run on this machine" claim is
stale and false: `/api/health` returned `ok`, version `1.2.1`, with 70 models
registered and 16 ready. `[live]`

The problems are concentrated in **truthfulness and parity**, not in the
existence of an engine:

1. **Practice mode is not what the UI and roadmap say it is.** Count-in is a
   dead toggle, "wait" mode advances a counter but never pauses the audio,
   "Loop section" loops the whole file, and speed is 25-200% rendered offline
   (6.91 s for a 4 s clip), not 25-400% real-time. `[static] [live]`
2. **Analysis overclaims.** "Chords" is one global label chosen from six
   templates; "downbeats" is a fixed 4/4 grid from a possibly spurious BPM;
   "sections" is an energy heuristic. None of these appears in the Analysis UI.
   The traceability ledger nevertheless marks 192 of 206 rows `verified`;
   R-0038/39/40/87 are contradicted by the source. `[static] [live]`
3. **A no-op enhancement is reported as success.** Auto-enhance can finish
   `done` with `chain: []` and no `file_id`; the CLI is honest ("No file
   written"), the API/UI contract is not. `[live]`
4. **The local API is not safe against browser CSRF.** It sends no CORS
   headers, answers `OPTIONS` with 501, but parses a `text/plain` JSON body and
   performs mutations. Any webpage can start jobs, change preferences, write
   sessions, grant local plugins, or trigger tool installs; uploads have no
   size cap. `[live]`
5. **The desktop app is not standalone.** Tauri spawns `python` from `PATH` on a
   fixed port 8377, has no bundled sidecar, no updater, and the release workflow
   builds unsigned. The PyInstaller spec is a separate model-free CLI/UI build
   that the Tauri bundle does not use. The launcher installs `[all]` (including
   torch) into a venv and requires Python 3.10/3.11/3.12; this machine's venv is
   3.13.14. `[static]`
6. **The model zoo is mostly unavailable in this environment.** 70 models are
   registered, 16 are ready, all neural entries are deferred, and the machine
   had 4 GB free before cleanup (7.7 GB immediately after removing audit temp
files; 4.6 GB later). The
   default cache budget is 20 GB. Rubber Band, yt-dlp, websockets, Verovio,
   MuseScore, and the soundfont are absent. `[live]`
7. **The Transpose parity surface is large but tractable.** The extension has
   35 UI groups / 802 recursive strings / 55 locales, plus clips, markers,
   scenes, library, MIDI learn, site adapters, tab capture, real-time DSP,
   formant/vocal-reducer/EQ, and accounts/cloud/subscription. Neiro has some of
   the hard engine work already; it has almost none of the real-time player,
   library, i18n, or site-integration work. `[static]`

**No P0 (remote-code or data-loss) finding was confirmed.** The highest severity
is **P1**: the practice/analysis truth gap, the CSRF/mutation surface, the
non-standalone packaging, the model/disk reality, and the red CI lint job.

**Recommended order:** make claims true and close the API/security/CI holes
first; then build one shared real-time Web Audio/WASM player used by the app and
the optional extension; keep the Python engine as the queued high-quality path;
then add library/practice tools; then the extension; then i18n, packaging, and
quality evidence. Do **not** start by porting the extension UI.

---

## 1. Baseline and scope

### 1.1 Repository and release

| Item | Value | Evidence |
|---|---|---|
| Repo | `C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant` | path |
| Branch / commit | `main` / `c3cc5c0` (merge of release 1.2.1) | `git log` |
| Tag | `v1.2.1` | `git tag` |
| Package / API | `neiro 1.2.1`, API version 1 | `/api/version` `[live]` |
| Python | 3.13.14 in `.venv`; `requires-python >=3.10`; README says 3.10-3.12; CI tests 3.10-3.12 | `pyproject`, README, CI `[static]` |
| Frontend | React/TypeScript/Vite; `frontend@1.2.1`; CI Node 22 | `package.json`, CI `[static]` |
| Desktop | Tauri 2.11 shell, fixed port 8377, system Python | `src-tauri` `[static]` |
| Engine | standard-library HTTP server on loopback; threaded; Python sidecar | `src/neiro/ui/server.py` `[static] [live]` |
| Licence | MIT core; optional model licences vary | `pyproject`, `docs/models.md` `[static]` |

### 1.2 What was verified live

The engine was started with `python -m neiro.cli ui --no-browser --port 8380`
and driven with a generated 4 s stereo probe (440 Hz centre, 220/330 Hz sides,
low noise). Timings are for this probe only, not a benchmark.

| Check | Result |
|---|---|
| `/api/health` | `ok`, version 1.2.1, engine `python-sidecar` |
| `/api/version` | name `neiro`, version 1.2.1, API 1 |
| Models | 70 registered; 16 ready in the API view |
| Compute | CPU only, 16 GB; no accelerator |
| Tools | Verovio, MuseScore, soundfont all unavailable |
| Plugins | none registered |
| Upload | 200; analysis returned bpm 79.5, key A major, 1 chord, 1 section, 2 downbeats |
| Separate (`vocals`) | done in 1.96 s; model `dsp-center`; files vocals/instrumental/residual; null-test value present |
| Pitch-correct | done in 6.8 s; the worktree `server.py` fix works; progress events present |
| Enhance auto | **done with `chain: []` and no output file** |
| Enhance explicit `normalize` | works; output file produced |
| Time-stretch (`rate=2`) | 6.91 s; provenance `phase-vocoder`; no Rubber Band |
| Pitch-shift (`+2`) | 0.7 s; provenance `pv+resample` |
| Session save/open | works; **a string `notes` value came back as a list of characters** |
| Ingest URL | 422, "yt-dlp not installed" (optional feature) |
| CORS preflight | `OPTIONS` 501; no `Access-Control-Allow-Origin` |
| CSRF probe | `text/plain` JSON body was parsed; unknown file returned 400, not 415 |
| Traversal probe | `/files/../../Windows/win.ini` and encoded soundfont path returned 404/400 |
| CLI analyze | exit 0; same 1 chord / 2 downbeats / 1 section |
| CLI separate | exit 0; DSP centre fallback; files written |
| CLI enhance auto | exit 0; "Nothing to repair; output would equal input. No file written." |
| CLI enhance `normalize` | exit 0; file written |
| CLI transcribe | exit 0; 1 note; MIDI written |
| CLI session save/list | works; writes `%LOCALAPPDATA%\Neiro\sessions\*.neiro.json` |
| CLI watch `--once` | works; processes the inbox and writes outputs |

The generated probe is deliberately tonal and non-musical. It is useful for
contract checks, not for judging musical quality. The false-positive echo
("100 ms, 97%") on a periodic synthetic signal is a reminder that heuristics
need confidence and musical fixtures.

### 1.3 Tests, lint, build

| Check | Result |
|---|---|
| `pytest --collect-only` | 220 tests across 32 files |
| `pytest -q -m "not slow" --basetemp C:\np` | exit 0; 219 passed, 1 skipped |
| Default pytest temp on Windows | exit 1 **after tests passed**, in pytest cleanup: `ValueError: scandir: path too long`; use a short `--basetemp` |
| `ruff check .` | pass |
| `ruff format --check .` | **fail**: `docs/adding-models.md:40`, `docs/session.md:26`; CI runs this exact command |
| Frontend `npm ci` | 32 packages; succeeded |
| Frontend `tsc -p tsconfig.app.json --noEmit` | pass |
| Frontend `vite build --outDir C:\np\frontend-dist` | pass |
| Frontend lint (`oxlint`) | passes with warnings (hooks deps, fast-refresh export, practice effect deps); no test script |
| Rust `cargo fmt --all -- --check` | pass |
| Rust `cargo check` / clippy | **not run locally**: no `src-tauri/target`; disk was 2.2 GB at the time; CI covers it |
| `scripts/verify_models.py` locally | **70/70 failures**: it shells out to `neiro` on `PATH`; the venv's `Scripts` dir is not on `PATH` |
| `scripts/verify_models.py` in CI | likely passes because `pip install -e .` puts `neiro` on `PATH`; fix the script to use `sys.executable` anyway |

The Python suite is real and worth protecting. The Windows temp-path failure is
a test-harness defect, not a product failure; it should be fixed in
`pyproject.toml`/CI docs or by using a short basetemp in the test command.

### 1.4 Environment reality

| Resource | State |
|---|---|
| Disk | 4 GB free at audit start; 7.7 GB immediately after deleting audit temp artifacts; 3.8-4.6 GB later (final check 3.8 GB); the volume is volatile; default cache budget 20 GB |
| RAM / GPU | 16 GB RAM; CPU only; no CUDA/ROCm accelerator reported |
| Python packages | core `numpy`, `scipy`, `soundfile`; no `torch`, `onnxruntime`, `audio-separator`, `yt-dlp`, `websockets`, `pytest`, `ruff` initially; audit added `pytest`/`ruff` to `.venv` |
| `pip` | not installed in the uv-managed `.venv`; use `uv pip` or `uv run` |
| Rubber Band | not on `PATH` |
| ffmpeg | 7.1 present |
| Verovio / MuseScore / SF2 | absent (all three reported by `/api/tools`) |
| Node | 24 locally; CI uses 22 |
| Rust | 1.97.0; no target directory |
| Git worktree | dirty; see 1.5 |

### 1.5 Uncommitted work that must be preserved

`git status --short` at audit time:

```
 M .gitignore
 M CODE_OF_CONDUCT.md
 M SECURITY.md
 M pyproject.toml
 M scripts/live_install_test.bat
 M src/neiro/ui/server.py
 D src/neiro/ui/static/icons.svg
?? .cursor/
?? .gitattributes
?? .graphify/
?? .graphify_claude_hook_installed
?? .graphify_hook_installed
?? AGENTS.md
?? CLAUDE.md
?? GEMINI.md
?? skills-lock.json
```

Key points:

- **`src/neiro/ui/server.py` contains the essential `pitch_correct` progress fix.**
  Do not revert it. The live job now reports progress and completes; before the
  fix the integration path failed. Commit it with a regression test before any
  refactor.
- `pyproject.toml` adds uv conflict configuration and install guidance; it is
  work in progress but useful. `git diff` shows no unrelated rewrite.
- `.gitignore` adds `/graft/` and `.env*`; `SECURITY.md` removes a personal
  email; `scripts/live_install_test.bat` fixes a relative path.
- `src/neiro/ui/static/icons.svg` is deleted. I searched the tree for
  `icons.svg` references and found none; the React UI uses inline icons. The
  deletion is safe/cleanup, not a current 404. Preserve the user's intent.
- Untracked `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.graphify/`, `.cursor/`, and
  `skills-lock.json` are user/agent configuration. Do not delete or rewrite
  them. The project rules require graph-first investigation; see 1.6.

### 1.6 Graph-first project rules and toolchain

`AGENTS.md` (graft) and `CLAUDE.md`/`GEMINI.md` (graphify) require querying the
repository graph before raw reads. The graph artefacts exist:

- `.graphify/graph.json` (4 MB), `.graphify/GRAPH_REPORT.md`;
- `graft/` cards with exact `file:line` spans.

Operational facts:

- `graft` is **not on PATH** in this environment. The cards under `graft/` are
  still useful and can be read directly.
- `graphify` **is** installed (`C:\Users\ericc\AppData\Local\Programs\Python\Python310\scripts\graphify.exe`),
  but the package is 0.9.36 while the installed skill is 0.17.1. The graph uses
  the pre-#1504 node-ID scheme. `graphify query` works with
  `--graph .graphify/graph.json`; it defaults to a non-existent
  `graphify-out/graph.json`, and it prints version warnings.
- The graph was built from committed `c3cc5c0`, so it does **not** include the
  dirty `server.py` fix. Treat the graph as a map, not as the current worktree.

### 1.7 What is genuinely strong (do not regress)

- **Separation/restoration/transcription engine:** real DSP floor plus optional
  neural adapters, model registry, 70 manifests, 13 presets, plan graph,
  provenance, null-test residual, ensemble support.
- **Studio:** multi-track timeline, clips, trim/split/fade/gain/normalize/
  reverse, bounce/combine, mute/solo/gain/pan, A/B original-vs-stems, null test,
  beat snap, spectrogram, selection loop, undo/redo, mashup packs.
- **MIDI Studio:** transcription, piano roll, score, edit, practice panel,
  metronome, WebMIDI/DAW wait wiring, MIDI/MusicXML/PDF exports when tools are
  present.
- **Engine contract:** local HTTP API, job progress/cancel, artifacts, cache,
  session JSON with model pins, CLI parity, watch folder.
- **DAW:** real VST2 bridge with audio capture and MIDI forwarding; CLAP/VST3
  is the stub (see A9).
- **Privacy:** loopback bind, no telemetry by default, MIT core, provenance.
- **Tests:** 219 passing Python tests, frontend type-check/build, Rust fmt.
- **UI craft:** themes, density, motion preferences, command palette, skip
  link, live regions, honest "no PDF" states.

The port plan must reuse these, not replace them with a browser toy.

### 1.8 What was not verified

- The Transpose extension was not executed. Its feature inventory is from 332
  files, the manifest, UI strings, notices, and code reading. No live site,
  tab-capture, model download, WebGPU, or account flow was exercised.
- No listening test or perceptual evaluation was performed. The audit makes
  no claim about how good Neiro's or Transpose's audio sounds.
- No neural model was downloaded or run; all neural status is from the registry
  and the live "ready" count. No GPU exists on this machine.
- No full MUSDB18-HQ/MoisesDB/MAESTRO/Slakh/GuitarSet/ADTOF run; those corpora
  are not provisioned.
- `cargo check`, clippy, the Tauri bundle, installers, signing, macOS/Linux,
  extension store review, and full accessibility/i18n audits were not run.
- The 4 s synthetic probe is not a musical quality benchmark.

---

## 2. Audit findings (Neiro)

Severity: **P1** = release/correctness/security blocker or a claim that will
mislead a user; **P2** = major feature gap or degraded reliability; **P3** =
docs/tooling/maintainability. No P0 was confirmed.

### 2.1 Practice mode: the UI says more than the code does

**F-01 — Count-in is a dead toggle. P1. `[static]`**

`frontend/src/modules/midi/MidiPracticePanel.tsx` declares `countIn` at L19 and
renders a button at L295-L297, but there is no other reference to `countIn` in
the file. It is not passed to the metronome, the audio element, or the scheduler.
The button changes colour and nothing else. The README (L161) and
`docs/ui.md` (L75) advertise "count-in".

**F-02 — "Wait" mode does not wait for audio. P1. `[static]`**

`advance()` (L44-L51) increments a note index and sets feedback. The keyboard
handler (L145-L151) and WebMIDI handler (L161-L179) call `advance()`. The
`<audio>` element (L335-L343) is never paused, seeked, or gated by the note
index. The hint at L326-L331 says "Playback waits at each note...", but playback
continues. This directly contradicts traceability R-0087 ("Playback halts at
each note/chord group and waits").

**F-03 — "Loop section" loops the whole file. P1. `[static]`**

The same component has only `loop={looping}` on the `<audio>` element (L339).
There is no A/B selection, no loop start/end, and no scheduler. The button label
"Loop section" is false. Studio has a real selection loop (`loopSel`/`sel` in
`StudioModule.tsx` L906-L915 and L940), but the practice panel does not use it.

**F-04 — Practice speed is 25-200%, not 25-400%, and is offline. P1. `[static] [live]`**

The range is `min={0.25} max={2}` (L282-L290). Each speed change calls
`timeStretchFile(file.fileId, rate)` (L80-L111), which posts to `/api/edit`
`op: "time_stretch"`. That endpoint is synchronous and runs the whole file. On
the 4 s probe it took **6.91 s** (RTF ≈ 0.58). A 4-minute song at that rate is
minutes of waiting per speed change, and the effect has no progress or cancel.
The extension's 25-400% real-time control is a different class of feature.

**F-05 — "Pitch-preserving stretch ready" ignores provenance. P1. `[static] [live]`**

`dsp/edit.py` tries the `rubberband` CLI, then a phase vocoder, then a resample
fallback (`_try_rubberband` and the time-stretch path). The API returns a
`provenance` field (`phase-vocoder`, `pv+resample`, etc.), but
`MidiPracticePanel` only reads `res.audio_url` (L92-L95) and always says
"Pitch-preserving stretch ready". The browser fallback at L100-L103 sets
`playbackRate` and calls it a fallback; it does not assert pitch preservation.
The UI must show the actual method and quality state, or hide the claim.

**F-06 — The "cache" comment is not a cache. P2. `[static]`**

The comment at L80 says "Rubber Band / engine time_stretch cache for common
rates", but the effect has no cache map. Every 0.05 slider step creates a new
`/api/edit` request and a new registered file. On a long song this is both slow
and a disk-growth path (default cache budget 20 GB; see F-20).

**F-07 — Metronome context leak/duplication risk. P2. `[static]`**

The metronome effect creates `new AudioContext()` (L129) and closes it in the
cleanup only when `ctx.close()` is reached (L139-L141). The effect depends on
`metronome`, `speed`, `tempo`, and file; rapid toggles can create overlapping
contexts. This is not the top priority, but the real-time player should own one
audio context and one scheduler.

### 2.2 Analysis: schema present, behaviour and UI are not

**F-08 — "Chord lattice" is one global chord from six templates. P1. `[static] [live]`**

`src/neiro/analysis/report.py` L604-L611 defines exactly six templates
(`C`, `Am`, `F`, `G`, `Dm`, `Em`). `_estimate_chords` (L614-L635) dot-products
the global chroma, picks the top template, and returns one entry spanning
`0..duration`; the comment says "lattice can refine later". The live probe
returned `{chord: "Dm", confidence: 0.258, start: 0, end: 4}`. That is not a
chord-recognition transformer and not a chord timeline. Traceability R-0039
claims a transformer and a lattice. `capabilities` still advertises
`dsp-chord-lattice`.

**F-09 — "Downbeats" is a fixed 4/4 grid from an unqualified BPM. P1. `[static] [live]`**

`_estimate_downbeats` (L670-L680) computes `beat = 60/bpm`, `bar = 4*beat`, and
emits `0, bar, 2*bar, ...` with no beat tracking, no meter detection, no
confidence, and no phase estimate. The probe returned `0.0, 3.0186` because the
tempo estimator produced 79.5 BPM on a non-rhythmic signal. Traceability
R-0038 claims "Beat This!-class with madmom fallback" and a tempo curve. It is
not implemented.

**F-10 — "Sections" is an energy-block heuristic. P2. `[static]`**

`_estimate_sections` (L638-L667) splits audio into 4 s blocks above 8 s, labels
blocks by RMS relative to the median, and merges adjacent labels. It can
produce intro/verse/chorus-ish labels, but it is not structural segmentation,
and it does not power loop-a-section practice. Traceability R-0040 claims
section segmentation that powers practice workflows. The UI does not use it.

**F-11 — The Analysis UI does not display chords, sections, or downbeats. P1. `[static]`**

`frontend/src/modules/AnalysisModule.tsx` builds `rows` from duration,
loudness, tempo, key, bandwidth, instruments, echo, and notes (the render table
is L355-L365). There is no chord, section, or downbeat table/timeline; a search
of the frontend for those fields found only type definitions/plan notes. So even
the weak data above is dead data for the user. This is both a feature gap and a
contract-integrity problem: the report advertises capabilities the UI never
shows.

**F-12 — Tempo/key lack confidence and musical validation. P2. `[static] [live]`**

The 4 s probe produced 79.5 BPM and A major on a static tonal signal. The report
does not expose a tempo confidence or a "no reliable tempo" state. The extension
shows "No reliable result" in its chord view; Neiro should have an equivalent
honest state. A synthetic fixture is not a fair musical test, but the absence of
confidence is a real contract gap.

### 2.3 Enhancement and jobs

**F-13 — Auto-enhance can report `done` with no artifact. P1. `[live]`**

`_run_enhancement` (`server.py` L427-L465) builds a plan and sets
`result = {"chain": plan.chain, "notes": plan.notes}`. If `plan.chain` is empty,
it skips execution and the job still completes. The live API returned
`status: done`, `chain: []`, and no `file_id`; the CLI prints "Nothing to
repair; output would equal input. No file written." The API/UI need an explicit
`noop` result (`status: "done"`, `result.noop: true`, `reason`) or a 4xx
semantic error. The `RestoreModule`/job tray should not imply an output exists.

**F-14 — Long DSP edits are synchronous. P1. `[static] [live]`**

`/api/edit` handles `time_stretch` and `pitch_shift` inline (the handler starts
at `server.py` L1665). The live 4 s probe took 6.91 s for stretch and 0.7 s for
pitch-shift. There is no progress, no cancel, and no bounded queue. For a
practice feature this is the wrong execution model; it should be a managed job
with a cache keyed by `(file_id, op, params)` and a bounded result.

**F-15 — Pitch-correct is fixed in the worktree but uncommitted. P1. `[live] [static]`**

The dirty `server.py` change makes `_job_progress` consume `Progress` and fixes
the call/result shape. The live job completed in 6.8 s. This is exactly the kind
of work that must be committed with a regression test; if the worktree is
cleaned, the integration regresses to the bridge-documented failure.

**F-16 — Session notes are not a text field. P2. `[live]`**

`POST /api/session/save` accepts `notes`; the browser call passes a string; the
stored/returned value came back as a list of characters
(`["a","u","d","i","t",...]`). The UI never sends notes (`AppShell.tsx`
L170-L174 passes only `name`, `file_id`, `graph_config`). Transpose's 5,000-char
per-song notes feature therefore has no correct schema or UI in Neiro.

**F-17 — The default cache budget can fill the disk. P1. `[live] [static]`**

`/api/prefs` returned `cache_budget_gb: 20.0`; the machine had 4 GB free at the
start, 7.7 GB immediately after cleanup, and 4.6 GB later in the audit. There is
no startup preflight, no reserve, and no model-size check. `ArtifactCache(max_entries=64)` is entry-bounded, not
byte-bounded. A long session or a model install can exhaust the volume. This is
both a reliability and a data-loss risk (other applications/OneDrive).

### 2.4 Security and API contract

**F-18 — Local API has a browser CSRF surface. P1. `[live] [static]`**

- No `Access-Control-Allow-Origin`; `OPTIONS /api/health` returned 501. That
  blocks browser *reads* but not simple *writes*.
- `_read_body` (`server.py` L936-L938) reads `Content-Length` and returns the
  body without checking `Content-Type` or `Origin`.
- A `POST /api/separate` with `Content-Type: text/plain` and a JSON body was
  parsed; it returned 400 "unknown file_id", not 415. A malicious page can send
  a simple request that changes state.
- Mutating endpoints with no auth include `/api/prefs`, `/api/session/save`,
  `/api/plugins` (grants), `/api/tools` (pip install Verovio), `/api/models`
  (download), `/api/daw/*`, `/api/compute` (flush), `/api/ingest-url`, and
  `/api/upload`.
- No `Host`/`Origin` validation; DNS-rebinding and malicious-local-page
  scenarios are not addressed. `SECURITY.md` describes a local-first model but
  not this browser-CSRF threat.

The extension can use host permissions to bypass CORS, but that does not make
the API safe for the normal browser UI or for any other local consumer.

**F-19 — Uploads and JSON bodies have no size limit. P1. `[static]`**

`_read_body` trusts `Content-Length`. `/api/upload` (L1916 onward) reads the
entire body and registers it. A page can POST a large body to fill the 4-7 GB
volume; there is no maximum, quota, or streaming guard. Add a hard cap (e.g.
configurable, with a small default) and a disk preflight.

**F-20 — Plugin grants and tool installs are unauthenticated mutations. P1. `[static]`**

`/api/plugins` accepts a `grants` map (L1311 onward); `/api/tools` can install
Verovio via pip (L1584 onward). A CSRF request can grant a local plugin or
trigger a package install. Even if the plugin must already exist on disk, this
is a privilege/consent boundary violation. Require a per-install token and an
explicit local confirmation for these actions.

**F-21 — URL ingest is an SSRF/disk path when yt-dlp is installed. P2. `[static]`**

`/api/ingest-url` passes a user URL to the downloader. yt-dlp is absent here, so
the live call returned 422, but the endpoint is unauthenticated and has no
allowlist, size cap, or private-network guard. Treat it as a network egress
feature with an explicit policy.

**F-22 — Path traversal checks passed. Positive. `[live]`**

`/files/../../Windows/win.ini` and an encoded soundfont traversal returned
404/400. `_safe_name` sanitises upload names. Keep these tests.

### 2.5 Packaging, distribution, and environment

**F-23 — Tauri is a shell around system Python, not a standalone app. P1. `[static]`**

`src-tauri/src/lib.rs`:

- fixed `PORT = 8377` and `ENGINE_URL = http://127.0.0.1:8377/`;
- `python_candidates()` returns `pythonw`, `python`, `py`, `python3`;
- it spawns `-m neiro.cli ui --port 8377`;
- on failure it says "Is Neiro installed in this Python?".

`tauri.conf.json` has no `externalBin`/sidecar, no updater, no signing config.
`release.yml` builds the Tauri bundle unsigned (L85-L91). A user who installs the
desktop app without Python + the `neiro` package gets a shell that cannot start
the engine. Port 8377 is fixed; a conflict or another service on that port is
not handled.

**F-24 — The PyInstaller build and the Tauri build are two different products. P1. `[static]`**

`packaging/neiro.spec` builds a model-free PyInstaller CLI/UI folder. It is a
reasonable standalone core, but the Tauri bundle does not reference it.
`packaging/build_release.py` builds a wheel + launcher zip, optionally the
PyInstaller exe. `Neiro UI.bat` prefers a Tauri exe if present, otherwise creates
a venv, installs the bundled wheel with `[all]` (torch first) and runs
`python -m neiro.cli ui`. The launcher says "Requires Python
3.10/3.11/3.12". The current venv is 3.13.14. The one-click path on a fresh
machine with 4 GB free and no Python will fail or consume the disk.

**F-25 — Python support is contradictory. P1. `[static]`**

`pyproject` says `>=3.10`; README says 3.10-3.12; CI tests 3.10-3.12; the
launcher says 3.10/3.11/3.12; the live venv is 3.13.14 and the core runs. Optional
extras (AudioSR, some separators) explicitly need <=3.11/3.12. This is not a
single supported matrix. Pick one and test it; if 3.13 is supported, add CI and
fix extras; if not, pin `<3.13` and make the launcher refuse 3.13 with a clear
message.

**F-26 — Model availability is not a download problem; it is a capacity problem. P1. `[live]`**

70 registered, 16 ready, 20 DSP live-tested; all neural entries deferred. The
machine lacks torch/onnx/audio-separator; the disk is small; the cache budget is
20 GB. The app can run its DSP floor, but "port every Transpose feature" needs
chord/beat models and real stem models. A feature plan that assumes the model
zoo is ready is wrong.

**F-27 — The release is unsigned and has no updater. P2. `[static]`**

`release.yml` comments "Unsigned local build - code signing secrets are
optional"; `TAURI_SIGNING_PRIVATE_KEY` is empty. For a desktop audio app that
asks users to install a local engine, this is a trust/adoption blocker, not just
polish.

### 2.6 CI, tests, and developer experience

**F-28 — CI lint is currently red on `ruff format --check .`. P1. `[live] [static]`**

`ruff format --check .` fails on `docs/adding-models.md:40` and
`docs/session.md:26`. CI's `lint-python` job runs exactly that command. The
`ruff check .` step passes. This is a current release blocker independent of the
product code; fix the two fenced examples (or pin ruff, but pinning hides the
drift).

**F-29 — `verify_models.py` is PATH-fragile. P2. `[live] [static]`**

`scripts/verify_models.py` L212 runs `subprocess.run(["neiro", "models"])`.
When `neiro` is not on `PATH` (the normal local venv case), stdout is empty and
all 70 entries are reported "absent". Use `sys.executable -m neiro.cli models`
or resolve the console script; add a self-test for the parser. In CI
`pip install -e .` masks the bug.

**F-30 — The default pytest run fails its own cleanup on Windows. P2. `[live]`**

The tests passed, then pytest's temp cleanup hit `ValueError: scandir: path too
long` and exited 1. `--basetemp C:\np` fixed it. Document the short-path command
and/or configure a short basetemp in CI/test docs. Do not let a green test run
look red.

**F-31 — Frontend has no tests; its lint has warnings. P2. `[live]`**

`npm run lint` passes with warnings (e.g. `PlanStrip` exhaustive-deps,
`session.tsx` fast-refresh export, `MidiPracticePanel` effect deps), and
`package.json` has no test script, so CI's `npm run test --if-present` is a
no-op. The build/typecheck pass. The practice regressions above would have been
caught by a DOM/audio test; add one.

**F-32 — The Tauri/Rust build was not verified locally. P2. `[not run]`**

`cargo fmt --check` passes; `cargo check`/clippy were not run because no target
cache existed and disk was tight. CI runs them. Do not claim the desktop bundle
is verified until it is built on a clean machine.

### 2.7 Docs and traceability drift

**F-33 — The README is stale. P2. `[static]`**

- L222 says "Neiro 1.1.1" while the package/tag is 1.2.1.
- L82 says Python 3.10-3.12; L83 says `[all]` omits Basic Pitch/superres for
  3.12; the live venv is 3.13.
- L161 says Learn has "loop regions, count-in, metronome, step / WebMIDI / DAW
  wait mode"; F-01/F-02/F-03 show the actual practice panel does not.
- L215 lists Studio/Mixer/Learn/Prefs/session Save/Open with a status glyph;
  the session docs contradict it (F-34).

**F-34 — `docs/session.md` says the UI does not expose save/open. P2. `[static]`**

L64-L66: "**Not yet wired:** the UI doesn't yet expose 'save/open' as a user
action..." The current `AppShell.tsx` has session Save/Open dialogs and
`/api/session/save`/`open`; the CLI also works. The doc is stale in the
opposite direction from the usual complaint. The **notes** field is the part
that is not actually wired (F-16).

**F-35 — `SECURITY.md` is stale and incomplete. P2. `[static]`**

L5 says "Neiro is pre-1.0"; the supported table starts at 1.0.x; the current
release is 1.2.1. The document describes local-first/privacy but does not cover
the browser-CSRF/mutation surface (F-18), upload caps (F-19), plugin-grant
authorization (F-20), or SSRF (F-21).

**F-36 — `docs/daw-vst.md` and `docs/ui.md` disagree about Simple/Advanced. P3. `[static]`**

`docs/ui.md` L44: "There is no Simple/Advanced workspace toggle."
`docs/daw-vst.md` L3/L71-L72: "Advanced rail", "Advanced workspace", "Simple
workspace". The README and traceability still use the old vocabulary. Decide
one vocabulary and update all three.

**F-37 — The traceability ledger is structural, not behavioural. P1. `[live] [static]`**

`docs/roadmap-traceability.md` marks **192 of 206** rows `verified`.
`scripts/update_traceability_status.py` assigns status from keyword/file
matches; it does not execute the feature. Specific contradictions:

| Row | Claim | Actual |
|---|---|---|
| R-0038 | Beat This!-class beat tracker, tempo curve, downbeats | fixed 4/4 grid from `_estimate_downbeats`; no tracker |
| R-0039 | chord lattice from a transformer | one global chord from six templates |
| R-0040 | section segmentation powers loop-a-section | energy blocks; not used by practice/UI |
| R-0086 | speed 25-200%, engine-rendered pitch-preserving, in sync | 25-200% offline `/api/edit`; provenance ignored |
| R-0087 | playback halts at each note/chord group and waits | counter advances; audio never pauses |
| R-0090 | Verovio-class engraved rendering | optional/placeholder path; see `docs/ui.md` follow-ups |
| R-0102 | screen-reader support with ARIA live/structure | baseline ARIA exists; no completed audit |
| R-0108 | restricted plugin entry points with permissions | no sandbox; docs admit it |

The banner added to the ledger says exactly this. It is manual; if
`scripts/generate_traceability.py` regenerates the file, re-add the banner or
teach the generator to emit it, otherwise the warning will disappear. Do not
use "verified" as a quality claim in a handoff, release note, or port estimate.

**F-38 — `docs/performance.md` reads as a playback claim. P2. `[static]`**

L33 says "Every stage is real-time-capable"; the table is offline RTF for DSP
stages (analysis ~140x, centre extraction ~90x), and the live time-stretch was
0.58x on the probe. The sentence is defensible only if it means "the DSP stage
can process faster than real time", not "the player is real-time". Clarify.
L82 also admits perf budgets are **not** blocking CI.

**F-39 — The evaluation gate is synthetic only. P2. `[static]`**

`docs/evaluation.md` is honest: the always-on suite is ~30 closed-form cases;
MUSDB/MoisesDB/MAESTRO/Slakh/GuitarSet/ADTOF runners skip and exit 0 when the
corpus env vars are unset. It explicitly says synthetic alone is not enough for
R-0116-R-0119. That is a quality-evidence gap, not a lie. The audit should not
claim competitive separation/transcription quality.

### 2.8 Architecture and feature gaps

**F-40 — There is no real-time playback DSP layer.** P1. `[static]`

The app uses `<audio>` elements and Web Audio gain/pan in Studio; there is no
AudioWorklet, no WASM DSP, no shared transport clock for effects, no live
pitch/speed/formant/EQ/reducer, and no low-latency mode. Studio's `playbackRate`
is not a pitch-preserving real-time control. This is the single largest
Transpose-parity gap.

**F-41 — Library, playlists, notes, scenes, clips, markers, and practice ramp
are absent as user features.** P1. `[static]`

Neiro has session save/open and a session list, but not a song library with
playlists, versions, per-song notes, markers, practice clips, sequences, or
scenes. `AppShell` saves a session; it does not maintain a library. The
extension's `history`/`clipsWorkspace`/`studio.scenes` groups have no Neiro
equivalent.

**F-42 — MIDI is input-only, not a mapping system.** P2. `[static]`

WebMIDI is used to validate practice notes; there is no MIDI learn, no
note/CC/program/transport/MMC mapping, no device selection, no conflict
handling, and no persisted mapping. The extension's `shortcutSettings` group is
62 keys of mapping UI.

**F-43 — i18n is absent.** P2. `[static]`

The frontend strings are English in JSX/TS. There is no locale loader, no
plural/RTL handling, no terminology layer, no translation QA. The extension has
55 locales / 110 locale files and 802 recursive UI strings. Do not copy those
translations; build a new catalogue.

**F-44 — No browser extension or site adapter.** P1 for the optional addon.
`[static]`

Neiro has `yt-dlp` ingest (optional, absent) but no tab capture, no site
permissions UI, no direct player integration, no ad wait, no compact song bar,
and no side panel. The extension's `connectionInfo` group (20 keys) is the
diagnostics UX for this.

**F-45 — CLAP/VST3 is a stub; VST2 is the real bridge.** P2. `[static]`

`plugins/neiro-clap/README.md` calls itself a "CLAP/VST3 bridge stub"; the
exported entry points are placeholders (`src/lib.rs` comments). The production
path is `plugins/neiro-vst` (VST2). `docs/daw-vst.md` calls CLAP/VST3 a
"preview". The UI/docs must not imply a full CLAP/VST3 product.

**F-46 — Model licences need a distribution decision.** P2. `[static]`

The core is MIT, but `docs/models.md` includes `unknown` (LarsNet, SCNet,
VoiceFixer, Apollo, SonicMaster, AudioSR) and GPL-3.0 (Matchering) entries.
The launcher's `[all]` path can install optional extras, including GPL/unknown
ones; the model weights themselves are not bundled by default. An installer
that pulls them and a UI that offers them can create distribution obligations.
Legal review is required before claiming "all features".

**F-47 — Signed model index / plugin sandbox are primitives, not protections. P2. `[static]`**

`neiro.engine.signing` can HMAC-sign an index, but `default_registry()` still
scans local manifests only; there is no remote signed feed. Local manifest
adapters run in-process (docs: "There is no sandbox"). The `/api/plugins`
grants endpoint is unauthenticated (F-20). A "permission grant" UI is not a
sandbox.

**F-48 — Accessibility is a good start, not an audit. P2. `[static]`**

There are `aria-live` status regions, `aria-valuetext`, table captions,
skip/command-palette focus handling, and reduced-motion/theme preferences.
There is no axe/WCAG run, no screen-reader walkthrough, no keyboard-only
matrix, no focus-trap test, and no i18n/RTL. The traceability R-0102 row
overstates "verified".

**F-49 — `icons.svg` deletion is not a bug. Positive. `[static]`**

No source or HTML reference to `src/neiro/ui/static/icons.svg` was found. The
React UI has inline icons. The uncommitted deletion is safe cleanup; preserve
it, but do not treat it as a missing-asset bug.

**F-50 — The `learning-studio` bridge is a consumer, not Neiro.** P3. `[static]`

`learning-studio/docs/NEIRO-BRIDGE.md` documents `neiro-audio-job-v1`, CORS
absence, and measured job-shape defects. It is useful contract evidence. It is
not a Neiro module and should not be edited as part of this port. Its CORS
complaint is real (F-18); solve it in Neiro with a token/allowlist, not by
opening the API to every origin.

## 3. Transpose 6.5.4: complete feature ledger

### 3.1 Artifact and runtime facts

| Fact | Value |
|---|---|
| Extension ID / version | `ioimlbgefgadofblnajllknopjboejda` / `6.5.4` |
| Manifest | MV3, minimum Chrome 127 |
| Files / size | 332 files / 37.4 MB |
| Entry points | `sidepanel/index.html`, `popup/`, service worker, offscreen stem/player documents |
| Permissions | `activeTab`, `contextMenus`, `offscreen`, `scripting`, `storage`, `sidePanel`; optional `tabCapture`; optional host permissions for all sites |
| Runtime surfaces | side panel, popup, tab-capture document, offscreen stem document, content scripts injected on demand, `externally_connectable` to `transpose.video` |
| Audio processors | `aw-tp-processor.js` (main DSP), `aw-st-processor.js`, `aw-stem-capture-processor.js`, `rb.wasm` (Rubber Band; commercial Tune73 build) |
| Analysis / stems | `stem-offscreen.js`, `chunks/music-analysis-*`, `chunks/musetric-analysis-*`, `chunks/open-unmix-*`, ONNX Runtime Web |
| UI strings | `assets/i18n/ui/en.json`: 35 top-level groups, 512 first-level entries, **802 recursive leaves** |
| Locales | 55 locale directories, 110 i18n files (UI + terminology) |
| Direct media handling found in code | YouTube/YouTube Music, Spotify, SoundCloud, Deezer, Apple Music, Tidal, Vimeo; generic media elements and Tab Audio cover other pages |
| Store constraints | Chrome/Edge MV3; no Firefox parity verified; no mobile extension |

The extension was inspected statically. It was **not** run in a browser during
this audit; no site access, tab capture, model download, WebGPU pass, account,
or share flow was exercised. The feature list below is therefore a code/UI
inventory, not a live acceptance suite.

### 3.2 Feature groups (all 35 groups)

| Group | Keys | What it covers |
|---|---:|---|
| `toolbar` | 12 | Library, trial countdown, save, open in Player, share, enable/disable, settings, three scenes |
| `share` | 5 | Shared-session title/text, copy state, sign-in requirement |
| `common` | 18 | Cancel/save/edit/confirm/clear/reset/revoke/duplicate/delete/upgrade/sign-in/out/open/more |
| `sideOnboarding` | 6 | Expand/collapse, theme, scenes, help, start tour |
| `popupOnboarding` | 6 | Library, view mode, transpose, pitch, speed, A-B loop |
| `productEducation` | 3 | Compact welcome/trial, Studio intro, plan CTA |
| `equalizer` | 2 | Preset and filter-type selection |
| `settings` | 116 | Account, player, tab capture, popup/side panel, help, theme, language/terminology, seek/scrub, auto-save/reset/remember, analysis, premium/low latency, wheel, varispeed, extended range, scenes, shortcuts, MIDI, data/reset, pitch presets |
| `shortcutSettings` | 62 | Keyboard mappings, MIDI connection/learn/device, groups and actions |
| `loop` | 11 | A-B loop activate/deactivate, set start/end, cancel selection, count-in tooltip, add/delete/sort/jump/set marker time |
| `history` | 42 | Recent, save/update/new version, lists/favorites, rename/delete, empty states |
| `resumeCard` | 4 | Resume recent session, example video, time-ago |
| `clip` | 23 | Clip name/start/end, transpose/pitch/formant/speed, add/remove effects, enable/disable, reorder, loop count, play/pause/loop |
| `clipsWorkspace` | 35 | New clip, A/B set, count-in, effective settings, song/clip/default sources, sequence, practice ramp |
| `uiModeInfo` | 2 | Side-panel promotion/dismiss |
| `marker` | 1 | Set marker to current time |
| `connectionInfo` | 20 | Connection unavailable, no media, unsupported page, access required, Tab Audio fallback, pitch-only explanation, retry/troubleshoot |
| `transport` | 9 | Help, first, previous boundary, previous, play/pause, next, connecting, ad wait, start media |
| `timeline` | 3 | Zoom controls, in/out |
| `markers` | 8 | Add marker, add to clips, convert A-B loop, select loop range, list/blocks, edit done, set loop point |
| `banner` | 6 | Close, featured text, default/expired/trial banners, learn more, view plans |
| `subAlert` | 9 | Trial ending, past-due, cancellation/pause notices, billing CTA |
| `units` | 3 | Semitones, cents, Hz |
| `clips` | 1 | Default clip name |
| `varispeed` | 1 | Varispeed toggle |
| `recentSave` | 6 | Storage evicted/full/error, notes/song too large, identity unresolved |
| `notes` | 3 | Placeholder, 5,000-character limit, label |
| `eq` | 2 | Gain, frequency |
| `pitchPro` | 9 | Recording/instrument tuning presets, up/down, compact/collapse/reset |
| `vocalReducer` | 5 | Current/legacy/hybrid preview states, series/parallel, center-only, range |
| `stemPractice` | 22 | Stem Mix title/playback/reset/remove, waveform/chord view, target choose, crossfade, solo/mute, WebGPU notice, model install/download |
| `startTrial` | 2 | Maybe later, start free trial |
| `studio` | 19 | Reset audio, song bar, layout widgets, scenes, modes, activation/consent, slots, history, journey, login/save, plan |
| `login` | 17 | Sign in, trial choice, Google, account access, terms/privacy, marketing opt-in |
| `upgrade` | 19 | Active/inactive/paused/ended plans, plans, trial, features |

### 3.3 Playback and DSP features

- **Transpose:** ±12 semitones default; extended range to ±36; real-time
  pitch shift; coarse/fine controls; keyboard/MIDI mapping.
- **Pitch:** fine pitch in cents/Hz; Pitch Pro recording/instrument tuning
  presets; pitch display; reset.
- **Speed:** 25-400%; independent of pitch; low-latency mode; speed mapping.
- **Formant:** 0.2-2.0; formant-preserving/independent control; premium audio
  path; low-latency mode is explicitly unavailable with formant shifting.
- **Varispeed:** links pitch and playback speed without time-stretching
  (natural character).
- **Vocal reducer:** current reducer plus legacy algorithm; aggressive/current
  vs hybrid; crossfade vs parallel; series vs parallel; center-only vs full
  mix; selected-range vs full path; on/off and amount mappings.
- **Equalizer:** multi-band (6-band) EQ with gain/frequency per band, presets,
  filter types, on/off.
- **Premium audio:** high-quality pitch/formant processing for Studio songs;
  low-latency mode trades quality for latency.
- **A/B and loop:** A-B loop, count-in, loop activate/deactivate, loop range,
  markers, transport first/previous/next, scrub preview, seek interval.
- **Stem Mix:** 4 targets (vocals/drums/bass/other), solo/mute, target/backing
  crossfade, waveform/chord view, recording lock, model download; **requires
  WebGPU**.
- **Analysis playback:** waveform, chords/key, beats/tempo; analysis model
  install; "no reliable result" state.
- **Tab Audio:** capture tab sound and pitch-shift only; no direct player
  connection on unsupported pages; ad wait where detectable.
- **Player:** local files and supported media; "always open in Player";
  compact song bar; popup/side panel.

### 3.4 Practice, markers, clips, scenes

- **A-B loop:** set A/B, enable/disable, count-in, loop ranges, marker
  conversion, selection loop.
- **Markers:** add at current time, list view, blocks view, edit mode, jump,
  set loop point, add to clips.
- **Clips:** name, start/end, set from current time, count-in, transpose, pitch,
  formant, speed, effects add/remove, enable/disable, drag to reorder, loop
  count, play/pause/loop, effective settings with clip/song/default precedence,
  sequence.
- **Practice ramp:** chromatic, circle of fifths/fourths, scale (major,
  natural/harmonic/melodic minor), tempo range/unit, transpose range,
  divisions, repetitions, preview, create N clips.
- **Scenes:** standard, timeline, clip-sequence; widget layout (drag, compact,
  expanded, hidden); show/hide waveform, chords, rhythm; new/edit/duplicate/
  reset scene; custom scene names; fixed vs custom.
- **Stem practice:** target/backing crossfade, solo/mute, waveform/chord view,
  model install/download, recording speed lock.
- **Library practice context:** per-song loops, markers, clips, settings,
  notes; auto-save/recents; resume card.

### 3.5 Library, notes, and per-song data

- Recent history, saved library, playlists (default Favorites; create, rename,
  delete, move to default), save changes/update existing/save as new version,
  edit media, song identity/title.
- Per-song transpose/pitch/speed/tuning settings; per-song loops, markers,
  clips; "remember changes" per song/all songs/don't save; auto-reset vs keep
  settings; auto-save to recents.
- Notes: free text up to **5,000 characters**; storage warnings for notes too
  large, song too large, storage full, identity unresolved, storage error.
- Storage: recent eviction, clear history, clear stems, clear audio/analysis/
  models, revoke site permissions, reset preferences, reset scenes, reset all.
- Session/share: shared session links (sign-in required), default title/text,
  copy success/failure; cloud sync and account versions are paid/account
  features.

### 3.6 Sites, permissions, and connection UX

- Direct player integration on supported sites; per-site permission grant;
  access-required/no-media/unsupported/connection-unavailable states.
- Tab Audio fallback: captures tab sound and applies pitch shift only; prompts
  for browser capture permission; conflict detection when another extension
  interferes.
- Ad wait/start media/transport state; reload/troubleshoot/report issue.
- Local files opened in Player; compact song bar; popup or side-panel mode.
- No DRM circumvention: Tab Audio captures what the browser is playing; direct
  integration uses page media elements; neither decrypts protected media.

### 3.7 Settings, shortcuts, MIDI, i18n

- **Settings:** account/subscription; Player/always-open/compact bar; tab
  capture; popup vs side panel; help/guide/what's new/support; system/light/
  dark theme; UI and terminology language; seek interval; scrub preview;
  auto-save/auto-reset/persist/remember; music/chord/rhythm analysis; premium
  audio/low latency; mouse wheel; varispeed; extended range; scenes; keyboard
  shortcuts; MIDI; data/reset; pitch presets; version.
- **Keyboard:** enable in side panel/popup; custom mappings; conflict detection;
  reset/disable; extension shortcut; marker 1-9 actions.
- **MIDI:** device selection ("any connected device"), learn, clear, note/CC/
  program change/transport/MMC; one knob can control both directions; groups:
  Playback, Loop, Volume, Speed, Transpose, Pitch, Formant, Vocal Reducer,
  Equalizer, Markers; actions include play/pause, rewind/forward, speed/volume/
  transpose/pitch/formant up/down, reducer amount/on-off, EQ on/off, loop
  on/off, add marker, marker 1-9.
- **i18n:** 55 locales, separate UI and terminology language, automatic/system
  choice, English recommended; RTL/plural handling is in the locale system.
- **Onboarding/help:** side/popup tours, product education, trial banners,
  resume card, guide, what's new, support, issue reporting.
- **Accessibility:** ARIA labels on transport/stem/timeline controls, keyboard
  mappings, reduced-motion/theme preferences in the host browser; no formal
  WCAG claim was verified.

### 3.8 Accounts, cloud, subscription, and limit states

- Optional Google sign-in; account/profile; "continue without account"; saved
  songs and subscription access; marketing opt-in.
- Studio: **3 free active slots**, 7-day trial, unlimited subscription; slot
  swap/cooldown; plan active/inactive/paused/ended; trial/payment/cancellation
  banners; customer portal; resume/restart.
- Cloud sync, saved versions across reinstall, share links, and "open all
  saved songs" are account/paid features.
- Trial starts only when the user chooses it; without an account the app still
  supports 3 Studio songs.
- **Wide mode is not available yet** (explicit UI string).
- Stem Mix requires WebGPU; Tab Audio is pitch-only; low latency is not
  available with formant shifting.
- Model/analysis installs are local; the extension downloads model assets from
  its CDN; accounts/cloud are the only server dependencies.

### 3.9 Licences and what must not be copied

From `THIRD_PARTY_NOTICES.txt` and the manifest:

| Component | Licence / constraint |
|---|---|
| Open-Unmix UMX-HQ ONNX weights | MIT (upstream Open-Unmix); do not copy the extension CDN artefacts |
| ChordMini / BTC classifier | MIT (upstreams ChordMini, BTC-ISMIR19) |
| Beat This! small0 | MIT (upstream CPJKU/beat_this) |
| Musetric analysis runtime | MIT |
| ONNX Runtime Web | MIT |
| demucs-web | MIT |
| SoundTouchJS | LGPL-2.1; if used, comply with LGPL (dynamic linking/notices/source offer) |
| Rubber Band (`rb.wasm`) | **Tune73 commercial**; cannot be reused without a licence |
| Transpose code, UI, locale strings, images, and model CDN artefacts | proprietary/third-party; **do not copy** |

The port may reimplement behaviour. It may use upstream MIT model weights only
with their own licences and provenance; prefer Neiro's model registry or an
explicit new manifest. It must not ship `rb.wasm` or a decompiled equivalent.

### 3.10 Known Transpose limits to preserve as product decisions

- Wide mode unavailable.
- Tab Audio is pitch-shift only.
- Stem Mix requires WebGPU.
- 3 free Studio slots; trial/subscription; cloud/share require sign-in.
- Premium audio/low-latency trade-offs; low latency disabled with formant.
- Model downloads and analysis model installs can fail; UI has explicit
  install/failed/no-result states.
- Site support is permissioned and player-dependent; unsupported pages fall
  back to Tab Audio.
- No evidence of DRM bypass; do not add one.
- Chrome/Edge MV3 only for the verified code path; Firefox/Safari parity is not
  established.

## 4. Neiro ↔ Transpose parity matrix

Status: **N** native/working, **P** partial/degraded/offline, **S** stub/no-op,
**M** missing, **N/A** deliberate non-goal. Mode: **RT** real-time browser
player, **Q** queued Neiro engine, **RT+Q** hybrid, **Addon** extension surface,
**N/A** not applicable. Priority is the port priority, not the audit severity.
"Neiro today" is deliberately terse; the evidence is in Part 2 and Part 3.

### 4.1 Playback, DSP, practice

| ID | Transpose capability | Neiro today | Stat | Target | Mode | Pr |
|---|---|---|---|---|---|---|
| T-01 | Real-time transpose ±12 / extended ±36 | Offline `pitch_shift` only; no player control; no extended-range UI | P | Shared Neiro Player | RT+Q | P1 |
| T-02 | Fine pitch in cents/Hz | None | M | Player pitch control | RT | P1 |
| T-03 | Speed 25-400%, independent of pitch | Practice 25-200%; whole-file `/api/edit`; 6.91 s for 4 s | P | Player speed 25-400% + queued render of current settings | RT+Q | P1 |
| T-04 | Formant 0.2-2.0 | None | M | Player formant | RT | P1 |
| T-05 | Varispeed link | None; browser `playbackRate` is only a failure fallback | M | Player varispeed toggle | RT | P2 |
| T-06 | Vocal reducer (current/legacy/hybrid, center/range) | Offline karaoke separation; no live reducer | M | Player reducer; optional Q karaoke | RT+Q | P1 |
| T-07 | 6-band EQ, presets/filter types | Studio Mix has gain/pan only | M | Player EQ | RT | P1 |
| T-08 | Pitch/tuning presets (Baroque/Classical/etc.) | None | M | Player tuning reference | RT | P2 |
| T-09 | Pitch display (cents/Hz) | None | M | Player readout | RT | P2 |
| T-10 | Premium audio / low-latency mode | None | M | Player quality modes; label trade-off | RT | P1 |
| T-11 | Time-stretch provenance/quality indicator | API returns provenance; practice UI ignores it and always says "pitch-preserving" | P | Show method + quality; no false claim | RT+Q | P1 |
| T-12 | Per-note pitch correction (Neiro strength) | Native job; works (6.8 s for 4 s) | N | Q export + preview tuner readout (autocorrelation) | Q+RT | P2 |
| T-13 | Local playback/transport | Native `<audio>`/Studio transport; no shared clock | N | Player + Studio dialog; granular transpose/speed + queued per-stem render; full engine open | RT | P1 |
| T-14 | Waveform/spectrogram | Native in Studio | N | Keep; share analysis view | Q | P3 |
| T-15 | A-B loop | Native in Studio selection (`loopSel`/`sel`); practice panel loops whole file | P | Shared Player A-B; blind ABX discrimination panel | RT | P1 |
| T-16 | Count-in | Dead `countIn` toggle; no scheduler use | S | Player/clip count-in | RT | P1 |
| T-17 | Markers (add/list/blocks/jump/convert A-B) | None | M | Library + Player + timeline | RT | P1 |
| T-18 | Clips (range, per-clip transpose/pitch/formant/speed/effects, enable, loop count) | Studio audio clips, not practice clips | M | Practice clip model + Player | RT | P1 |
| T-19 | Practice ramp (chromatic/circle/scale, tempo range, repetitions) | None | M | Clip sequence generator | RT | P2 |
| T-20 | Scenes (standard/timeline/clip sequence, widget layout) | None | M | Studio layout scenes + player scenes; widget layouts absent | RT | P2 |
| T-21 | Stem Mix (4 stems, solo/mute, target/backing crossfade, chord/waveform) | Native offline stems; Studio Mix gain/pan/mute/solo/A-B/null; no target crossfade/chord view | P | Crossfade/chord view + per-stem 3-band EQ; Q stems | RT+Q | P1 |
| T-22 | Clip sequence playback/loop counts | None | M | Player scheduler | RT | P2 |
| T-23 | Transport first/prev/next/ad wait | Studio transport; no site/ad state | P | Core + Addon transport | RT+Addon | P2 |
| T-24 | Wait mode actually pauses at notes/chords | Counter advances; audio never pauses | S | Gate Player; hands/tracks choices | RT | P1 |
| T-25 | Metronome/tempo sync | Native phase-locked metronome in MIDI practice | N | Keep; share with Player | RT | P2 |
| T-26 | Loop/count-in set from current time | None | M | Player + clips | RT | P1 |
| T-27 | DAW MIDI wait | VST2 forwards MIDI; practice does not gate audio | P | Gate Player; DAW capture | RT+Q | P2 |
| T-28 | Record/upload a take | VST2 capture/upload; no browser tab capture | P | Addon tab capture; keep VST2 | RT+Q+Addon | P2 |

### 4.2 Analysis, stems, models

| ID | Transpose capability | Neiro today | Stat | Target | Mode | Pr |
|---|---|---|---|---|---|---|
| T-29 | Chord changes + key | One global chord from 6 templates; key estimate; no chord timeline/UI | P | ChordMini/BTC-class ONNX or equivalent; confidence; timeline | Q | P1 |
| T-30 | Beats/tempo/downbeats | Tempo estimate; fixed 4/4 downbeats; no beat grid/UI | P | Beat This-class tracker; meter/phase; confidence; UI | Q | P1 |
| T-31 | Section boundaries | Energy-block heuristic; no UI/practice use | P | Real segmentation or clearly label heuristic | Q | P2 |
| T-32 | Analysis timeline (waveform/chords/beats) | Waveform/spectrogram yes; no chord/beat lane | P | Shared analysis timeline | Q+RT | P1 |
| T-33 | Install/status/no-result for analysis models | Model registry exists; no chord/beat models; Prefs model view | P | Model manifests, install/remove, no-result state | Q | P1 |
| T-34 | 4-stem UMX-HQ | Neiro has 4/6-stem models (optional); different model zoo | P | Keep Neiro models; add UMX-HQ only if licensing/quality demands | Q | P2 |
| T-35 | WebGPU in-browser stems | N/A for Neiro; CPU/optional GPU Python | N/A | Prefer Q; optional Addon WebGPU only if justified | Q/Addon | P3 |
| T-36 | Stem target/backing crossfade | Studio has gain/pan/solo/mute; no target crossfade | P | Add crossfade to Mix | RT+Q | P2 |
| T-37 | Stem A/B + null test | Native | N | Keep | Q | P3 |
| T-38 | Stem chord view | None | M | Chord timeline on stem view | Q+RT | P2 |
| T-39 | Real-time chord/beat display from precomputed analysis | None | M | Player timeline overlay | RT+Q | P2 |

### 4.3 Library, notes, data, sites

| ID | Transpose capability | Neiro today | Stat | Target | Mode | Pr |
|---|---|---|---|---|---|---|
| T-40 | Recent history / auto-save | Corrections autosave; no song recents/library | P | Library + recents | Q | P1 |
| T-41 | Saved songs / library | Session save/list only; no song library | P | SQLite library; import/export | Q | P1 |
| T-42 | Playlists / favorites / list management | None | M | Library playlists | Q | P1 |
| T-43 | Versions/update existing/save as new | Session save only; no version chain | P | Versioned library entries | Q | P2 |
| T-44 | Per-song settings/loops/markers/clips | Session graph config; no per-song artifacts | P | Library schema + Player + import | Q+RT | P1 |
| T-45 | Notes (5,000 chars) | API field only; string becomes char list; no UI | S | Scalar text field + notes pane | Q | P1 |
| T-46 | Song identity/title/source metadata | Filename + optional URL ingest; no library identity | P | Library metadata + source URL | Q | P1 |
| T-47 | Storage quotas/eviction/recent-save errors | Entry-bounded artifact cache; 20 GB budget > disk; no library quota | P | Byte budget, preflight, eviction, clear errors | Q | P1 |
| T-48 | Session save/open | Native UI/CLI/API; docs stale | N | Keep; add notes/migration | Q | P3 |
| T-49 | Session share/export | Session JSON; no share link | P | Local `.neiro.json` export; optional peer share | Q | P2 |
| T-50 | Resume card | None | M | Shell Resume card + Library recent/resume | Q | P3 |
| T-51 | Cloud-saved versions/account sync | None (deliberate) | N/A | Do not port; local export/backup | N/A | P3 |
| T-52 | Local file Player | Native Studio/Import; no compact bar | N | Shared Player + compact bar | RT | P2 |
| T-53 | Supported-site playback | yt-dlp ingest optional/absent; no streaming/player integration | M | Addon adapters; pairing/upload e2e verified in Chromium; live sites owner-run | Addon | P1 |
| T-54 | Tab Audio capture | None | M | Addon offscreen/tabCapture | Addon | P1 |
| T-55 | Site permissions/connection diagnostics | None | M | Addon site-access + engine health probe | Addon | P2 |
| T-56 | Ad wait/transport on sites | None | M | Adapter state blocks capture start during ads | Addon | P2 |
| T-57 | Compact song bar, popup/side panel | Desktop/browser app exists; no compact bar/extension panel | M | Addon side panel + player compact mode | Addon/RT | P2 |
| T-58 | URL ingest/download | Optional; yt-dlp absent (live 422) | P | Keep Q ingest; add clear optional install | Q | P1 |
| T-59 | Direct site adapters (YouTube/Spotify/SoundCloud/Deezer/Apple Music) | None | M | Addon adapter interface + fallback | Addon | P1 |
| T-60 | Always-open Player / open in player | None | M | Opt-in core preference (open Practice after import) | Addon | P3 |
| T-61 | Share links | None | N/A | Do not port cloud link; local session file | N/A | P3 |

### 4.4 UI, settings, MIDI, i18n, DAW, non-goals

| ID | Transpose capability | Neiro today | Stat | Target | Mode | Pr |
|---|---|---|---|---|---|---|
| T-62 | Themes system/light/dark | Native + high contrast/density/motion | N | Keep | — | P3 |
| T-63 | UI + terminology language, 55 locales | English-only strings; no i18n | M | i18next/ICU; en first, community locales | — | P1 |
| T-64 | Seek interval/scrub preview/wheel | Studio wheel zoom; no settings/scrub preview | P | Player settings | RT | P2 |
| T-65 | Custom keyboard shortcuts | Fixed shortcuts + command palette; not remappable | P | Shortcut service + conflict UI | — | P2 |
| T-66 | MIDI learn/mappings (note/CC/program/transport/MMC) | WebMIDI wait only; no mapping | M | MIDI service + persist | RT | P1 |
| T-67 | Studio modes compact/side/wide | Responsive UI; no scenes/wide; wide is an extension limitation | P | Compact track mode; scenes/wide remain; do not promise wide | RT | P2 |
| T-68 | Premium/low-latency settings | None | M | Player quality mode | RT | P1 |
| T-69 | Music/chord/rhythm analysis toggles/WebGPU | Server analysis always on; no WebGPU | P | Per-lane toggles (key/tempo, chords, beats) with persistence; Q analysis | Q | P2 |
| T-70 | Data/reset (history/stems/audio/models/permissions/settings/scenes) | Prefs/cache/model/tools partial; no library/permissions/scenes | P | Central data manager | Q | P2 |
| T-71 | Help/guide/what's new/support/onboarding tours | About, Studio help, command palette; no tours/what's new/support | P | Quick start + What's new in About; tours/support still absent | — | P2 |
| T-72 | Trial/resume/product education | No subscription; no trial/upsell | N/A | Do not port paid funnel; local onboarding only | N/A | P3 |
| T-73 | Accessibility (ARIA, keyboard, focus, motion) | Good baseline; no WCAG/axe/screen-reader audit | P | A11y audit + fixes | — | P1 |
| T-74 | Studio A/B, null test, undo/redo, spectrogram | Native | N | Keep | Q | P3 |
| T-75 | DAW VST2 bridge | Native VST2; Windows-first | N | Keep; test macOS/Linux | Q | P2 |
| T-76 | CLAP/VST3 bridge | Placeholder exports/stub | S | Real SDK or remove claim | Q | P2 |
| T-77 | Transcription/MIDI/score/lyrics | Native YIN floor + optional models; score/tools optional | N | Keep; improve tools | Q | P3 |
| T-78 | Restoration/enhancement | Native; auto-no-op contract bug | P | Fix no-op; keep chains | Q | P1 |
| T-79 | Separation/stem quality | Native optional models; 16/70 ready; disk constrained | P | Model install/disk policy; Q | Q | P1 |
| T-80 | CLI/API parity | Native and strong; `verify_models` PATH bug | N | Keep; add contract tests | Q | P2 |
| T-81 | Local-first privacy | Native intent; CSRF/upload/plugin-grant holes | P | Token/Origin/caps/consent | Q | P1 |
| T-82 | Account/Google sign-in | None (deliberate) | N/A | Do not port | N/A | P3 |
| T-83 | Subscription/trial/plans/billing | None (deliberate) | N/A | Do not port; all local features free | N/A | P3 |
| T-84 | 3 Studio slots/swap/cooldown | None; no artificial slot limit | N/A | Do not port; local library | N/A | P3 |
| T-85 | Cloud sync | None (deliberate) | N/A | Do not port; local backup/export | N/A | P3 |
| T-86 | Marketing/analytics | None; local-first | N/A | Do not port | N/A | P3 |
| T-87 | Wide mode | N/A (extension says unavailable) | N/A | Do not port as a promise | N/A | P3 |
| T-88 | Tab Audio pitch-only / WebGPU stem requirement | N/A (extension limits) | N/A | Addon can do more; keep honest limits | N/A | P3 |

### 4.5 Parity reading

- **Transpose wins on interaction:** real-time controls, practice clips,
  markers/scenes, site integration, MIDI learn, library/notes, i18n.
- **Neiro wins on depth:** offline separation/restoration/transcription,
  provenance, sessions, CLI/API, VST2 capture, local privacy, model registry.
- **Do not flatten Neiro into a browser clone.** The shared player is the new
  surface; the Python engine remains the quality path.
- **N/A is a decision, not an omission.** Accounts/cloud/subscription/share
  links/3-slot limits are not local-first features. If the owner wants literal
  commercial parity, that is a separate product/legal decision with a different
  plan and cost.

## 5. Port plan: real-time player + queued quality + optional companion

### 5.1 Goal and non-goals

**Goal:** make every *capability* in Part 3 usable in Neiro with a clean-room
implementation, without losing Neiro's offline quality, local-first privacy, or
existing engine.

**Definition of parity:** a user can perform the same task and get an equivalent
outcome (same controls, same practice/learning loop, same library context, same
quality class). It does **not** mean pixel-identical UI, copied strings/assets,
or identical model weights.

**Non-goals (owner confirmation requested):**

- Account/Google sign-in, cloud sync, share links, subscription/trial/3-slot
  limits, billing, marketing opt-in. Neiro is local-first; a paid funnel is a
  different product.
- DRM bypass or audio extraction from protected streams. Tab capture only
  processes what the browser is allowed to play.
- Copying Transpose code, UI, images, locale strings, or `rb.wasm`.
- Reusing the extension's CDN model artefacts. Use upstream licences or Neiro's
  registry.
- A promise that "Wide mode" exists; the extension itself says it does not.
- Replacing Neiro's separation/restoration/transcription engine with
  in-browser models. The engine remains the quality path.

If the owner wants literal commercial parity (accounts/cloud/subscription/
share links), stop and scope that as a separate product with legal, backend,
billing, privacy, and support work. Do not smuggle it into "port the features".

### 5.2 Recommended architecture

```
                         ┌────────────────────────────────────────────┐
                         │ Neiro core (Tauri / browser UI)            │
                         │  Library / Studio / Analysis / Practice    │
                         └───────────────┬────────────────────────────┘
                                         │ shared TypeScript player SDK
                         ┌───────────────▼────────────────────────────┐
                         │ Neiro Player SDK                           │
                         │  Web Audio graph + AudioWorklet + WASM DSP │
                         │  transport, A-B, count-in, markers, clips  │
                         └───────────────┬────────────────────────────┘
              ┌──────────────────────────┴──────────────────────────┐
              │                                                     │
   ┌──────────▼──────────┐                              ┌───────────▼──────────┐
   │ Real-time (RT)      │                              │ Queued (Q)           │
   │ pitch/transpose     │                              │ stems, chords/beats  │
   │ speed, formant      │                              │ pitch-correct, export│
   │ EQ, vocal reducer   │                              │ restoration, models  │
   │ loop/practice       │                              │ progress/cancel/cache│
   └──────────┬──────────┘                              └───────────┬──────────┘
              │                                                     │
              └──────────────────────┬──────────────────────────────┘
                                     │ local HTTP API (token + Origin allowlist)
                         ┌───────────▼────────────────────────────┐
                         │ Neiro Python engine (existing)         │
                         │ jobs, models, separation, analysis,   │
                         │ provenance, sessions, CLI/API          │
                         └────────────────────────────────────────┘
                                     │
                    optional ┌───────▼────────┐
                             │ Neiro Companion│  MV3 side panel + offscreen
                             │ (browser addon)│  tab capture + site adapters
                             └────────────────┘
```

The same Player SDK runs in the React app and in the extension. The Python
engine is not asked to be real-time. The extension is optional; Neiro must work
without it.

### 5.3 Real-time vs queued: the contract

| Concern | Real-time (RT) | Queued (Q) |
|---|---|---|
| Transpose/pitch/speed/formant/EQ/reducer | AudioWorklet/WASM; parameter smoothing; latency budget | High-quality render for export; optional native stretcher |
| A-B loop, count-in, markers, clips, practice ramp | Player scheduler; no server round-trip | Persist markers/clips; optional rendered practice mix |
| Practice wait (MIDI/keyboard) | Pause/resume the player at note/chord boundaries | Use transcription result; no per-note server calls |
| Stems | Preview original/centre extraction; never pretend separated | Neiro separation; progress/cancel; replace preview via A/B |
| Chords/beats | Display precomputed timeline; low-latency overlay | ChordMini/BTC + Beat This-class analysis; confidence; cache |
| Pitch-correct | Tuner/readout; preview | Neiro per-note correction job; provenance |
| Enhancement/restoration | Bypass or simple preview | Neiro chains; no-op must be explicit |
| Site audio | Addon tab capture + Player SDK | Optional upload to Neiro for stems/analysis |
| Quality claim | "Preview" label; actual method shown | "Rendered" label; model/params/provenance shown |

**Rules:**

1. Never call a Python phase-vocoder render "real-time".
2. Never show "pitch-preserving" without reading the actual provenance.
3. Never block the UI on a whole-file render. Long edits become jobs with
   progress, cancel, and a bounded cache.
4. Never upload audio anywhere except the paired loopback engine; no telemetry.
5. The extension's queued features degrade to "Preview only" with a clear
   message when Neiro is not running.

### 5.4 Shared Neiro Player SDK

Proposed layout:

```
frontend/src/player/
  AudioEngine.ts             # one AudioContext, graph lifecycle, latency hint
  Transport.ts              # master clock, play/pause/seek, A-B loop, count-in
  PlayerSurface.tsx          # waveform + controls, used by app and addon
  worklets/player-processor.ts
  wasm/neiro_dsp.wasm        # built artefact; no remote code
  params.ts                 # transpose, pitch, speed, formant, eq, reducer
  markers.ts / clips.ts     # scheduler data model
  provenance.ts             # RT/Q quality labels
```

Implementation decisions:

- **One AudioContext** per player, `latencyHint: "interactive"`; reuse it for
  metronome/transport; close only on teardown. The current practice panel creates
  a context per metronome effect (F-07); do not repeat that.
- **AudioWorklet** owns the stretcher/pitch shifter and the transport sample
  clock. UI changes are messages; no React state on the audio thread.
- **WASM DSP candidate:** Signalsmith Stretch (preferred MIT candidate; verify
  the current licence and formant support before committing) or a clean-room
  WSOLA/phase-vocoder/PSOLA implementation. SoundTouchJS (LGPL-2.1) is a
  fallback only with LGPL compliance. **Do not use `rb.wasm` or the Tune73
  build.** Keep Neiro's Python phase vocoder for queued/export fallback, clearly
  labelled.
- **Effect order:** varispeed/link -> stretcher/pitch -> formant -> vocal
  reducer -> 6-band EQ -> gain/limiter. Allow bypass per stage; smooth every
  parameter; add a click-free crossfade when changing mode.
- **A-B and clips:** sample-accurate scheduling in the worklet/transport, not
  `<audio loop>`. Count-in uses the existing metronome phase-lock; markers and
  clips are data, not DOM.
- **Practice wait:** the player pauses at the current note/chord boundary and
  resumes on the expected Space/Enter, WebMIDI note, or DAW MIDI. This is a
  state machine over the transcription timeline; it must be tested with and
  without audio.
- **Latency targets:** local file <30 ms control-to-audio in the desktop app;
  tab capture <150 ms including browser capture; show measured latency in
  diagnostics. Low-latency mode bypasses formant/quality stages; label it.
- **Provenance:** every rendered result carries `{engine, method, model,
  params, sample_rate, duration, warnings}`. The UI shows "Preview
  (phase-vocoder)" vs "Rendered (Neiro job)" and never hides a fallback.
- **Fallback:** if WASM fails to load, use a clearly labelled `<audio>` +
  `preservesPitch` fallback; keep the app usable, but do not claim parity.

Integration order:

1. New Player used by MIDI Practice (replace whole-file `<audio>` and fix
   F-01..F-05).
2. Studio transport uses the same clock (keep stem gain/pan and A/B).
3. Addon reuses the Player Surface and worklet; no second DSP implementation.

### 5.5 Optional Neiro Companion (MV3)

**Shape:** Chrome/Edge MV3 side panel + offscreen document + service worker +
on-demand content scripts. It is a companion, not a replacement for the desktop
app.

- **Permissions:** `sidePanel`, `offscreen`, `scripting`, `storage`,
  `activeTab`, optional `tabCapture`, optional host permissions per site. Do not
  request `<all_urls>` at install; ask per site.
- **Site adapters:** a small interface (`getMedia`, `play/pause/seek`,
  `getTime`, `mute`, `metadata`, `isAd`, `observe`) for direct handling of
  YouTube/YouTube Music, Spotify, SoundCloud, Deezer, Apple Music, Tidal, and
  Vimeo; generic `<video>/<audio>` and Tab Audio fallback for other pages.
- **Tab capture:** `chrome.tabCapture.getMediaStreamId` + offscreen
  `AudioContext`/`MediaStreamAudioSourceNode`; route through the Player
  worklet; mute the page element via the content script while processing, and
  restore on stop. Test double-audio, navigation, ads, and capture revocation.
  Do not attempt DRM bypass.
- **Standalone mode:** real-time DSP works without Neiro. Queued stems/
  analysis/pitch-correct show "Pair Neiro to render" and a local pairing action.
- **Pairing:** Neiro shows a short-lived one-time code; the extension exchanges
  it for a per-install token stored in `chrome.storage.local`. All local API
  calls use the token; the extension never gets a wildcard CORS grant.
- **CORS:** extension service-worker fetches to `127.0.0.1` use host permissions;
  the normal web UI uses same-origin. Neiro should still enforce a token,
  `Origin` allowlist, `Content-Type`, and request caps. No `*`.
- **Privacy:** audio stays local; no analytics; no remote code; bundle the WASM;
  store only settings/mappings/session metadata; provide "clear data".
- **Store:** Chrome/Edge first; Firefox/Safari only after tab-capture/DSP parity
  is proven. Document permissions and privacy in the listing.
- **Optionality:** no core feature may require the extension. The app remains
  fully usable in a browser tab or Tauri without it.

### 5.6 Library, notes, markers, clips, scenes

Use a local **SQLite** library at `%LOCALAPPDATA%\Neiro\library.db` (or the
platform equivalent), not a growing JSON/session directory.

Minimum schema:

- `songs` (id, title, artist/source, duration, fingerprint, created/updated,
  last_played, notes, settings_json);
- `sources` (song_id, path/url, kind, hash);
- `versions` (song_id, label, session_path, settings_json, created);
- `playlists` / `playlist_items` (default Favorites; ordering);
- `markers` (song_id, time, label, color, kind);
- `clips` (song_id, name, start/end, count_in, settings_json, enabled,
  loop_count, order);
- `scenes` (song_id or global, name, type, layout_json);
- `mappings` (MIDI/keyboard device + action + value);
- `jobs` / `render_cache` (content hash, params, artifact, bytes, last_used).

API/frontend:

- `GET/POST/PATCH/DELETE /api/library/...`, `/api/playlists/...`,
  `/api/songs/<id>/markers|clips|notes|versions|scenes`;
- auto-save recent and per-song changes; explicit save/version; export/import
  `.neiro.json`; migration from existing session files;
- byte-bounded cache with disk preflight and user-visible eviction; fix
  F-17/F-47;
- notes as a **scalar** with a 5,000-character cap and a proper schema
  (F-16);
- no cloud; local backup/export is the share path.

### 5.7 Analysis and models

- Add a real chord/beat path behind optional extras:
  - **ChordMini/BTC** (MIT) and **Beat This! small0** (MIT) are the obvious
    upstream candidates; use ONNX Runtime (MIT) or an equivalent local runtime.
  - Wrap each as a normal Neiro manifest/adapter, with upstream licence,
    weight hash, input/output contract, and a confidence/no-result state.
  - Do not bundle weights in the repo; download with hash verification and
    disk preflight; keep the signed-index primitive in the loop when it becomes
    a remote feed.
- UI: chord lane, beat/downbeat grid, key/meter, confidence, "no reliable
  result"; this is the missing part (F-11).
- Keep the DSP heuristics as a fast fallback, clearly labelled "heuristic"; do
  not call them a transformer.
- Use Neiro's existing separation models for stems; do **not** add UMX-HQ or
  WebGPU solely to match the extension. If a quality/portability gap remains,
  add a model, not a second stem stack.
- Add a model-management screen with size, licence, status, install/remove,
  and disk impact. Make "neural unavailable" a first-class state.

### 5.8 Security and API contract (must land before the addon)

- Per-install API token; require it on all mutations and (optionally) reads.
- `Origin` allowlist (same-origin + paired extension IDs); `Host` validation;
  reject `null`/unexpected origins for mutations.
- Require `Content-Type: application/json` for JSON endpoints; reject
  `text/plain` (F-18). Add CSRF tests.
- Hard request-body/upload caps; disk preflight; quota/eviction; never fill the
  volume (F-19/F-17).
- Authenticate/consent `/api/plugins` grants and `/api/tools` installs; a
  local UI confirmation dialog is not enough if the API is reachable from a
  page (F-20).
- URL ingest: explicit allowlist/private-network block/size cap, or make it a
  CLI-only feature with a warning (F-21).
- Signed model index and plugin sandbox: either implement or state the trust
  boundary in the UI/docs; do not call a grant map a sandbox (F-47).
- Keep the existing path-traversal tests and add upload/MIME/symlink tests.
- Optional CORS for learning-studio: token + explicit origin allowlist; never
  `Access-Control-Allow-Origin: *`.

### 5.9 Packaging and distribution

- Build a **sidecar** from `neiro.spec` (model-free core) or an equivalent
  frozen/uv standalone; ship it as a Tauri `externalBin`/resource. Remove the
  assumption that `python` exists.
- Dynamic port selection (or a UNIX socket/localhost ephemeral port); persist
  the chosen port; health/restart; no fixed 8377 collision (F-23).
- Bundle the frontend static build, manifests, and model-free DSP; model
  installer is separate and opt-in.
- Windows first, signed installer; add updater/signing config; then macOS
  (notarization) and Linux (AppImage/deb) only after tests. The current release
  is unsigned (F-27).
- Python support: pick 3.12 for the sidecar/release; either add 3.13 CI or pin
  `<3.13`; make the launcher enforce the same matrix (F-25).
- Fresh-machine acceptance: install with no Python, 8 GB free, no models;
  launch, analyze a WAV, separate with DSP, export, uninstall cleanly. Then test
  a model install with a disk preflight.

### 5.10 i18n, MIDI, and accessibility

- **i18n:** `i18next` + ICU messages; extract all JSX strings; start `en`, then
  a small set of community locales; separate UI vs terminology; plural/RTL;
  no copied Transpose translations. 55 locales is a program, not a one-PR
  deliverable.
- **MIDI:** one Web MIDI service; device selection; learn; note/CC/program/
  transport/MMC; mapping groups (playback/loop/volume/speed/transpose/pitch/
  formant/reducer/EQ/markers); conflict detection; persist per device; browser
  permission flow (side panel may need a tab); extension uses the same service.
- **Accessibility:** axe/WCAG pass; keyboard-only matrix; focus traps; live
  regions for job/practice state; reduced motion; contrast; screen-reader
  walkthrough of Player, Analysis, Library, Practice; document limits. Do not
  claim "verified" until the receipt exists.

### 5.11 Phases, estimates, exit criteria

Estimates are rough and assume one focused engineer; they are not commitments.

| Phase | Work | Exit criteria | Est. |
|---|---|---|---|
| **0. Truth & safety** | Commit/preserve `pitch_correct` fix + regression; fix auto-enhance no-op; session notes; `verify_models`; `ruff format` docs; CSRF/Origin/Content-Type/upload caps/plugin consent; truth labels for practice/analysis; traceability banner; docs drift | CI green; 220+ tests; security probes return 415/401/413 as designed; no false "pitch-preserving"/"verified" claims | 1-3 days |
| **1. Player SDK** | One AudioContext; AudioWorklet/WASM stretcher; transpose/pitch/speed/formant/EQ/reducer; A-B/count-in; provenance; integrate MIDI Practice and Studio | 4-minute song: <30 ms local control latency, no whole-file wait; A-B/count-in/wait actually work; method shown; tests/listening receipt | 1-2 weeks |
| **2. Practice & library** | Markers/clips/scenes/ramp; SQLite library/playlists/versions/notes; auto-save; migration; MIDI learn; keyboard mappings | Create/play/loop a clip sequence; notes round-trip; library survives restart; MIDI mapping works; no data loss | 1-2 weeks |
| **3. Analysis** | ChordMini/BTC + Beat This-class manifests/adapters; confidence/no-result; chord/beat timeline; disk preflight; evaluation | Chord/beat timeline on real fixtures; no-result on silence/noise; model optional; cache/disk tested | 1-2 weeks |
| **4. Addon** | MV3 side panel; offscreen tab capture; direct site adapters; generic fallback; pairing/token; standalone RT; Q handoff; privacy/store docs | YouTube/Spotify/SoundCloud e2e; no double audio; capture revocation; no remote code; Q works only when paired | 2-3 weeks |
| **5. i18n/a11y/packaging** | i18next + top locales; MIDI/a11y; sidecar/externalBin; dynamic port; updater/signing; installer; model manager | Fresh Windows install without Python; signed build; a11y receipt; locale smoke; no system-Python dependency | 1-2 weeks |
| **6. Quality/release** | Full corpora where available; listening panel; perf CI; license review; store/release; docs | Release checklist with evidence; no "verified" without receipts; licences cleared | ongoing |

### 5.12 Coverage map: every extension group

Every group from Part 3 maps to at least one matrix row. This is the completeness
check for "port everything":

| Group | Matrix rows |
|---|---|
| `toolbar` | T-40, T-48, T-52, T-57, T-60, T-61, T-62, T-71 |
| `share` | T-49, T-61 |
| `common` | T-62, T-71 (shared UI states) |
| `sideOnboarding`, `popupOnboarding`, `productEducation` | T-71, T-72 |
| `equalizer`, `eq` | T-07 |
| `settings` | T-02..T-10, T-29..T-33, T-63..T-70, T-81 |
| `shortcutSettings` | T-65, T-66 |
| `history` | T-40..T-49 |
| `resumeCard` | T-50 |
| `clip` | T-18, T-44 |
| `clipsWorkspace` | T-18..T-22, T-26 |
| `uiModeInfo` | T-57, T-67 |
| `loop` | T-15, T-16, T-26 |
| `marker`, `markers` | T-17, T-26 |
| `connectionInfo` | T-53..T-56 |
| `transport` | T-23, T-24 |
| `timeline` | T-32 |
| `banner`, `subAlert` | T-72 (N/A paid funnel) |
| `units` | T-02, T-08, T-09 |
| `clips` | T-18 |
| `varispeed` | T-05 |
| `recentSave` | T-47 |
| `notes` | T-45 |
| `pitchPro` | T-08, T-09 |
| `vocalReducer` | T-06 |
| `stemPractice` | T-21, T-34..T-39 |
| `startTrial` | T-72 (N/A) |
| `studio` | T-20, T-67 |
| `login` | T-82 (N/A) |
| `upgrade` | T-83 (N/A) |

### 5.13 Acceptance / definition of done

A phase is done only with a receipt, not a checklist:

- **Correctness:** failing test or repro first, then green; API contract tests;
  no-op/enhance/pitch-correct/session-notes cases covered.
- **Audio:** null test for bypass; click/zipper test; A-B timing; count-in
  phase; pitch/speed/formant/EQ/reducer listening panel; no clipping; method
  label matches provenance.
- **Latency:** measured local/tab-capture; report numbers and device.
- **Security:** CSRF/Origin/Content-Type/upload/plugin/tool/SSRF tests; no
  wildcard CORS; token rotation/revocation.
- **Library:** create/edit/reopen/migrate/export; crash-safe; disk quota.
- **Addon:** real browser e2e on at least three sites; capture stop/revoke;
  no double audio; no remote code; privacy.
- **Packaging:** fresh VM install without Python; signed; uninstall; model
  install/remove.
- **i18n/a11y:** locale smoke + RTL/plural; axe/keyboard/screen-reader receipt.
- **Docs:** claims match code; traceability statuses have evidence; no stale
  version/support tables.

### 5.14 Risks and owner decisions

| Risk / decision | Recommendation |
|---|---|
| "All features" vs local-first non-goals | Do not port accounts/cloud/subscription/share/3-slot limits. Record the decision in an ADR; local export/backup is the equivalent. |
| Stretcher licence | Verify Signalsmith Stretch's current licence and formant support; prefer MIT. SoundTouchJS LGPL only with compliance. Do not use `rb.wasm`/Tune73. |
| Real-time quality vs latency | Two modes: Preview (low latency) and Rendered (Q). Show the method; never call a phase-vocoder preview "Rubber Band". |
| Addon architecture | Hybrid: standalone RT + optional paired Neiro Q. Do not require the extension for core app use. |
| Library storage | SQLite with migrations; not JSON files; byte-bounded cache. |
| Analysis models | ChordMini/BTC + Beat This-class MIT upstream; ONNX Runtime; optional extra; confidence/no-result. |
| Packaging | Bundled sidecar + dynamic port + signing/updater; Python 3.12 pin; no system Python. |
| API security | Token + Origin allowlist + Content-Type + caps; plugin/tool consent; SSRF policy. |
| i18n scope | en first, then community; 55 locales as a program; no copied strings. |
| Site adapters | Direct adapters for the five verified types; generic/tab fallback; expect breakage; no DRM. |
| Model downloads/disk | Preflight; opt-in; show sizes; no multi-GB download without consent; signed index. |
| Quality evidence | Synthetic + provisioned corpora + listening; perf CI; no competitive claim without numbers. |
| Project boundary | `music-assistant` only; `learning-studio` bridge is a consumer; do not edit it for this port. |

## 6. Verification receipt

### 6.1 Commands and results

| Command / probe | Result | Label |
|---|---|---|
| `git status --short` | dirty worktree as listed in 1.5; no source edit by this audit | `[live]` |
| `git log -1` | `c3cc5c0` merge release/1.2.1 | `[live]` |
| `neiro --version` / package metadata | 1.2.1 | `[live]` |
| `neiro models` | 70 entries | `[live]` |
| `/api/health` | `ok`, 1.2.1, python-sidecar | `[live]` |
| `/api/version` | name `neiro`, API 1 | `[live]` |
| `/api/models` | 70; 16 ready in API view | `[live]` |
| `/api/tools` | Verovio/MuseScore/soundfont absent | `[live]` |
| `/api/plugins` | empty | `[live]` |
| `/api/compute` | CPU only, 16 GB, no accelerator | `[live]` |
| `POST /api/upload` (4 s probe) | 200; report; 1.05 s warm / 5.78 s cold | `[live]` |
| `POST /api/separate` `vocals` | done 1.96 s; `dsp-center`; vocals/instrumental/residual; null-test field | `[live]` |
| `POST /api/pitch_correct` | done 6.8 s; progress; fixed in worktree | `[live]` |
| `POST /api/enhance` auto | **done, chain [], no output** | `[live]` |
| `POST /api/enhance` `normalize` | done; output produced | `[live]` |
| `POST /api/edit` `time_stretch` | 6.91 s; `provenance=phase-vocoder` | `[live]` |
| `POST /api/edit` `pitch_shift` | 0.7 s; `provenance=pv+resample` | `[live]` |
| `POST /api/session/save` with string notes | notes returned as character list | `[live]` |
| `POST /api/ingest-url` | 422; yt-dlp absent | `[live]` |
| `OPTIONS /api/health` | 501; no CORS headers | `[live]` |
| `text/plain` JSON to `/api/separate` | parsed; 400 unknown file_id | `[live]` |
| traversal probes | 404/400; no escape | `[live]` |
| `neiro analyze` | exit 0; 1 chord, 2 downbeats, 1 section | `[live]` |
| `neiro separate` | exit 0; DSP files | `[live]` |
| `neiro enhance` auto | exit 0; "No file written" | `[live]` |
| `neiro enhance --chain normalize` | exit 0; file | `[live]` |
| `neiro transcribe` | exit 0; MIDI | `[live]` |
| `neiro session save/list` | works | `[live]` |
| `neiro watch --once` | works | `[live]` |
| `pytest --collect-only` | 220 tests / 32 files | `[live]` |
| `pytest -q -m "not slow" --basetemp C:\np` | exit 0; 219 passed, 1 skipped | `[live]` |
| default pytest temp | exit 1 after pass; long-path cleanup | `[live]` |
| `ruff check .` | pass | `[live]` |
| `ruff format --check .` | fail: `docs/adding-models.md:40`, `docs/session.md:26` | `[live]` |
| `npm ci` | 32 packages; pass | `[live]` |
| `tsc -p tsconfig.app.json --noEmit` | pass | `[live]` |
| `vite build --outDir C:\np\frontend-dist` | pass | `[live]` |
| `npm run lint` | pass with warnings; no test script | `[live]` |
| `cargo fmt --all -- --check` | pass | `[live]` |
| `cargo check`/clippy | not run (no target; disk) | `[not run]` |
| `scripts/verify_models.py` | 70/70 failures due PATH `neiro` | `[live]` |
| `GET /api/health` after cleanup | not re-run; previous run healthy | `[not run]` |

### 6.2 Environment cleanup performed by the audit

- Installed `pytest`, `pytest-cov`, `ruff` into `.venv` (the venv had no pip;
  used `uv pip`). These are dev tools, not app source changes. They remain in
  the venv.
- Installed `frontend/node_modules` with `npm ci` for type-check/build, then
  removed it to free disk.
- Created and removed `C:\np` smoke/playwright temp data, test WAVs, API
  outputs, and server logs.
- Removed the audit session files (`audit-*`) from
  `%LOCALAPPDATA%\Neiro\sessions`.
- Removed the default pytest long-path temp trees; this restored free space
  from 0.62 GB to 7.7 GB (4.6 GB observed later). The machine is still below the
  app's 20 GB default cache budget.
- No model weights were downloaded. No `yt-dlp`/Verovio/MuseScore/SF2 install
  was performed. No source file was edited; the only intended repo changes are
  this audit, `HANDOFF.md`, and the traceability banner.

### 6.3 What remains unverified

- Live Transpose execution/site adapters/tab capture/WebGPU/account/share.
- Neural model downloads and quality; full evaluation corpora.
- GPU/accelerator behavior; long-file performance; macOS/Linux.
- Tauri/CLI installers/signing/updater; fresh-machine install.
- Screen-reader/WCAG/axe; i18n/RTL.
- Cargo check/clippy/build; extension store review.
- Audio quality/listening; no claim is made.

---

## 7. Source map

| Area | File |
|---|---|
| HTTP API, jobs, edits, uploads, CORS/CSRF surface | `src/neiro/ui/server.py` |
| API extras (sessions, notes, plugins, tools, DAW) | `src/neiro/ui/api_extras.py` |
| Planning / presets / model choice | `src/neiro/engine/planner.py` |
| Model registry/manifests | `src/neiro/engine/registry.py`, `src/neiro/manifests/` |
| Session format | `src/neiro/engine/session.py` |
| Time-stretch/pitch-shift/pitch-correct | `src/neiro/dsp/edit.py` |
| Analysis report/chords/sections/downbeats | `src/neiro/analysis/report.py` |
| Practice UI (count-in/wait/loop/speed) | `frontend/src/modules/midi/MidiPracticePanel.tsx` |
| Studio transport/Mix/A-B/loop | `frontend/src/modules/StudioModule.tsx` |
| Analysis UI | `frontend/src/modules/AnalysisModule.tsx` |
| Session menu/save/open | `frontend/src/shell/AppShell.tsx` |
| API client/pitch/time-stretch calls | `frontend/src/api/client.ts` |
| Tauri shell/engine spawn | `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json` |
| Packaging/launchers | `packaging/neiro.spec`, `packaging/launchers/`, `packaging/build_release.py` |
| VST2/CLAP | `plugins/neiro-vst/`, `plugins/neiro-clap/` |
| CI | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |
| Bridge contract evidence | `C:\Users\ericc\OneDrive\Desktop\Programs\learning-studio\docs\NEIRO-BRIDGE.md` |
| Extension source | `C:\Users\ericc\AppData\Local\Google\Chrome\User Data\Profile 1\Extensions\ioimlbgefgadofblnajllknopjboejda\6.5.4_0` |
| This audit / handoff | `docs/AUDIT.md`, `HANDOFF.md` |

---

## 8. Docs/claim drift register

| Source | Claim | Actual |
|---|---|---|
| `README.md:222` | Neiro 1.1.1 | package/tag 1.2.1 |
| `README.md:82-83` | Python 3.10-3.12; extras constraints | live venv 3.13.14; `pyproject >=3.10`; CI 3.10-3.12; launcher 3.10-3.12 |
| `README.md:161` | Learn: loop regions, count-in, wait | whole-file loop; dead count-in; wait counter only (F-01-03) |
| `docs/ui.md:44` | no Simple/Advanced workspace toggle | `docs/daw-vst.md` says Advanced/Simple; README/traceability use old terms |
| `docs/ui.md:75` | Rubber Band when available; wait modes | Rubber Band absent; phase vocoder; wait not gating |
| `docs/session.md:64-66` | UI does not expose save/open | `AppShell` and API do; notes are the unwired part |
| `SECURITY.md:5,12` | pre-1.0; 1.0.x support | 1.2.1 current |
| `docs/performance.md:33` | every stage real-time-capable | offline RTF stages; 0.58x time-stretch probe |
| `docs/performance.md:82` | perf budgets not CI-blocking | still true; no perf gate |
| `docs/evaluation.md:10` | external corpora skip/exit 0 | true; synthetic only for CI |
| `docs/roadmap-traceability.md` | 192/206 verified | structural keyword/file matching; R-0038/39/40/87 contradicted |
| `CHANGELOG.md` 1.2.0 | Rubber Band practice speed | no Rubber Band on this machine; phase-vocoder fallback |
| `docs/daw-vst.md:78-83` | CLAP/VST3 preview | placeholder exports; VST2 production |
| `plugins/neiro-clap/README.md` | bridge stub | confirms stub; not a full plugin |

The README `docs/ui.md:154-157` "honest follow-ups" list is itself accurate:
full Verovio polish, signed remote index, plugin sandbox, full MUSDB tables,
in-app watch panel. Use it as a model for the rest of the docs.

---

## 9. Security attack surface (summary)

| Surface | Current | Required |
|---|---|---|
| Local HTTP mutations | no token; JSON parsed without Content-Type; text/plain CSRF; `OPTIONS` 501 | token + Origin/Host + Content-Type + CSRF tests |
| Uploads/bodies | `Content-Length` trusted; no cap | hard caps, streaming, disk quota |
| Plugin grants | unauthenticated `/api/plugins`; no sandbox | local consent + token; document trust; sandbox or remove |
| Tool installs | `/api/tools` pip install; unauthenticated | token/consent; no silent installs |
| URL ingest | untrusted URL; SSRF/disk when yt-dlp installed | allowlist/private-network block/size cap or CLI-only |
| Model downloads | local manifests; signed index primitive not wired | hash verification; signed feed; disk preflight |
| Session/prefs | unauthenticated writes | token/Origin; schema validation |
| DAW endpoints | local bridge; no auth | token/local-only; instance validation |
| Static/files | path traversal tests pass | keep tests; MIME/CSP hardening |
| Tauri CSP | good `default-src 'self'`, connect/media limited | keep; add updater/signing |
| Extension (planned) | no remote code; local-only data | host permissions, pairing, no telemetry, store privacy |

Positive security facts: binds `127.0.0.1`; path traversal probes failed;
`_safe_name` sanitises names; Tauri CSP restricts connect/media; no telemetry
by default; model provenance/hash fields exist; no cloud audio.

---

## 10. Model and licence notes

- **Live:** 70 manifests, 16 ready, 20 DSP entries live-tested; all neural
  entries deferred; no torch/onnx/audio-separator; CPU only; 16 GB.
- **Disk:** 4 GB free at start, 7.7 GB immediately after cleanup, 4.6 GB later;
  default cache budget 20 GB. Full model zoo and multiple neural installs are
  not feasible without deleting data or adding storage.
- **Neiro model licences:** mostly MIT; `unknown` for LarsNet/SCNet/VoiceFixer/
  Apollo/SonicMaster/AudioSR; check `docs/models.md` and the upstream sources.
  Matchering/other entries need a legal review before distribution. This audit
  is not legal advice.
- **Transpose model licences:** UMX-HQ, ChordMini/BTC, Beat This, Musetric,
  ONNX Runtime Web, demucs-web are MIT per `THIRD_PARTY_NOTICES`; SoundTouchJS
  is LGPL-2.1; Rubber Band `rb.wasm` is Tune73 commercial.
- **Port choice:** upstream MIT models or Neiro registry; no extension CDN
  artefacts; no `rb.wasm`; no copied locales/assets.
- **Quality evidence:** none of these models was executed here; "ready" is a
  registry/package state, not a musical quality claim.

---

## 11. Open owner decisions

1. **Literal "all features" or local-first parity?** Recommend local-first;
   accounts/cloud/subscription/share/3-slot limits are N/A. If literal, scope a
   separate product and budget legal/backend/billing.
2. **Stretcher licence:** verify Signalsmith Stretch (MIT/formant) vs
   SoundTouch (LGPL) vs a clean-room implementation. Do not use Rubber Band
   without a commercial licence.
3. **Addon:** hybrid standalone RT + paired Neiro Q (recommended) vs
   companion-only vs full standalone with in-browser models.
4. **Packaging:** bundled sidecar + dynamic port + signing/updater (recommended)
   vs system Python (current) vs PyInstaller-only desktop.
5. **Library schema:** SQLite (recommended) vs JSON/session files.
6. **Analysis models:** ChordMini/BTC + Beat This MIT upstream (recommended) vs
   a Neiro-specific model vs no chord/beat parity.
7. **i18n:** en + community top locales (recommended) vs all 55 at once; never
   copy Transpose strings.
8. **API security:** token/Origin/caps (recommended) vs rely on loopback;
   loopback alone is not enough for browser CSRF.
9. **Quality bar:** synthetic + listening + provisioned corpora; no
   "verified" claim without a receipt.
10. **Project boundary:** Neiro only; `neiro-bridge` is a consumer. Do not
    change it for this port.

---

## 12. Bottom line

Neiro does not need a rewrite. It needs a **truth pass**, a **real-time player**,
a **library/practice layer**, a **real analysis model path**, an **optional
addon**, and **packaging/security/quality receipts**. The engine already does
the hard offline work; the extension is the interaction blueprint, not a code
source.

The first commit should not be a Transpose feature. It should be the dirty
`pitch_correct` fix plus a regression test, the no-op/CSRF/CI truth fixes, and
the traceability banner. After that, build one player and keep the Python engine
behind it for quality.

---

## 13. Implementation pass — 2026-10-20

This section records what changed **after** the audit above, and what still does not
exist. The gate is `python scripts/verify_goal.py --full` (18/18 PASS); every claim
below has a receipt in `docs/evidence/` and a criterion in `GOAL.md`.

### 13.1 Findings closed in this pass

| Finding | Resolution | Receipt |
|---|---|---|
| F-01 count-in dead | Player count-in generates clicks in the worklet and starts audio after the count | `tests/player.test.mjs`, `Transport.ts` |
| F-02 wait does not pause | Worklet stops at note onsets; keyboard/WebMIDI/DAW resume | `logic.test.mjs`, `PlayerSurface.tsx` |
| F-03 whole-file loop | A–B loop in the worklet with overshoot-preserving wrap | `logic.test.mjs`, gate C11 |
| F-04 25–200% offline speed | 25–400% real-time in the worklet; no `/api/edit` on speed change | gate C10/C11, latency receipt |
| F-05 provenance ignored | `describeMethod()` labels the actual phase-vocoder preview vs rendered/fallback | `params.ts`, gate C11 |
| F-06 no cache | Queued edits cache `(file_id, op, params)`; player needs no render | gate C17 |
| F-07 metronome context leak | One AudioContext; worklet owns metronome clicks | `AudioEngine.ts` |
| F-08 one global chord | Beat-synchronous chord timeline, 24 triads, confidence | `tests/test_analysis_timeline.py` |
| F-09 fixed 4/4 grid | Onset-flux beat grid with phase/confidence; 4/4 assumption labelled | same |
| F-11 analysis data not shown | Chord lane + beat lane in Analysis UI | gate C13 |
| F-13 enhance no-op | `noop: true` + `reason`, no `file_id`; UI shows "no changes needed" | `tests/test_contract_truth.py` |
| F-14 synchronous edits | `POST /api/edit/job` with progress, cancel, cache, provenance | gate C17 |
| F-15 pitch fix uncommitted | Committed with a regression test | commit `cf6c35b` |
| F-16 notes character list | Scalar `user_notes` (5,000 cap), legacy migration, UI field | `tests/test_contract_truth.py` |
| F-18 CSRF surface | Token, loopback Host, Origin allowlist, strict JSON type | 21 security tests |
| F-19 no body caps | 1 MiB JSON / 128 MiB upload caps + disk preflight | security receipt |
| F-20 unauthenticated grants/installs | Token + explicit `confirm: true` | security receipt |
| F-21 SSRF policy | Scheme/credential/private-host checks; documented as policy, not full SSRF | security receipt |
| F-28 ruff format red | Two doc fences fixed; format clean | gate C3 |
| F-29 verify_models PATH bug | `sys.executable -m neiro.cli` + test | gate C7 |
| F-33/F-34/F-35 docs stale | README version/range, session status, SECURITY threat model corrected | gate C15 |
| F-37 traceability overclaim | Banner rewritten to "structural, not behavioural" with row notes | gate C15 |
| F-38 performance misread | Clarified processing headroom vs player latency | `docs/performance.md` |
| F-40 no real-time DSP | Shared player with clean-room DSP | `docs/player.md`, gate C10 |
| F-41 no library | SQLite library + API + UI | `docs/library.md`, gate C12 |
| F-44 no companion | Optional MV3 addon source + validator | `docs/COMPANION.md`, gate C14 |
| F-78 enhance no-op | Same as F-13 | gate C5 |

### 13.2 Findings still open

| Finding | State | Why it remains |
|---|---|---|
| F-17 cache budget vs disk | **closed for declared sizes** | Disk note, half-free cache cap, 90% preference rejection, upload preflight, and a declared-size model-download preflight (507 before a job). Unsized weights are labelled in progress |
| F-23/F-24/F-25/F-27 packaging | **partial** | Dynamic port; installers with the engine; no-Python launch; Authenticode pipeline verified; updater plugin + signed artifacts + latest.json verified. Remaining: publish/host releases, trusted cert, clean-VM install/update, uninstall, Python matrix |
| F-26 model capacity | open | Still 16/70 ready, CPU-only, no torch/ONNX; no weights downloaded in this pass |
| F-31 frontend tests | **partial** | Vitest SSR tests cover the player markup/labels/overlay (5 tests, gate C22); no DOM/audio or user-event tests yet |
| F-32 Rust build | **closed for compile** | `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo check` pass; runtime launch still owner-run |
| F-36 vocabulary drift | open | `docs/ui.md` vs `docs/daw-vst.md` Simple/Advanced wording unchanged |
| F-39 evaluation corpora | open | Synthetic-only gate unchanged; no MUSDB/MoisesDB run |
| F-42 MIDI learn | open | WebMIDI wait works; no learn/CC/program/MMC mapping or persistence |
| F-43 i18n | partial | New player strings use a catalogue; app-wide i18n/RTL/plurals absent |
| F-45 CLAP/VST3 | open | Still a stub; VST2 remains the bridge |
| F-46/F-47 licences and sandbox | open | No legal review; grant map is still not a sandbox |
| F-48 accessibility audit | **partial** | Clean static audit (gate C21) + axe smoke on the player (0 serious/critical in jsdom); screen-reader/contrast still owner-run |
| F-52 player browser runtime | **closed for DSP path** | Chromium OfflineAudioContext: stem shifter 440→880 Hz; player preserves 440 at 2× and 880 at +12 (`docs/evidence/browser-worklet-2026-10-21.md`) |

### 13.3 Parity matrix movement (selected)

The matrix above is the audit-time baseline. Post-pass status:

| Rows | Audit | Now | Notes |
|---|---|---|---|
| T-01, T-03, T-04, T-05, T-06, T-07, T-08, T-15, T-16, T-24, T-26 | P/S/M | **RT native** | Shared player |
| T-02, T-09 | M | **RT native** | Fine pitch, cents and a sounding-A4 Hz readout |
| T-10, T-68 | M | **M** | Preview only; no low-latency/quality mode toggle |
| T-11 | P | **N** | Method label reflects actual DSP |
| T-17, T-18, T-19, T-22 | M | **RT native** | Markers (+ prev/next transport), clips, ramp, sequence |
| T-20 | M | **partial** | Player scenes (params/loop/markers/clips) + library scenes API; no Studio widget-layout scenes |
| T-21 | P | **partial** | Studio Mix adds a target/backing focus cross-fade; no stem WebGPU/target model |
| T-29, T-30 | P | **P (honest)** | Real timestamped heuristic + confidence, not transformer |
| T-31, T-32, T-33 | P | **partial/N** | Sections labelled heuristic; lanes in Analysis, the player and Studio; model install states unchanged |
| T-40–T-47 | P/M | **N/partial** | Library, notes, markers, clips, resume/reset, versions (save + list) |
| T-49 | P | **N** | Local JSON export + per-session `.neiro.json` download |
| T-53–T-57, T-59 | M | **Addon source** | Adapters + capture + panel; live e2e owner-run |
| T-63 | M | **partial** | All module surfaces incl. Studio help/messages catalogued; RTL `dir` plumbing and plural selection added; non-English catalogues and mirrored CSS remain |
| T-65 | P | **partial** | Player keyboard shortcuts remappable (9 actions); app-wide rail shortcuts still fixed |
| T-66 | M | **N** | MIDI learn (note/CC), 11 actions, clear, local persistence |
| T-78 | P | **N** | Auto-enhance no-op fixed |
| T-81 | P | **N** | Token/Host/Origin/type/caps/consent |

### 13.4 Residual risks

- The player is a **preview**, not a mastering-grade stretcher; transient smearing is
  expected. Nothing in the UI claims otherwise.
- Analysis is still a heuristic. It is now timestamped, confidence-scored and
  visible, but it is not ChordMini/BTC or Beat This.
- The companion was validated statically; live sites, EME-protected audio and
  capture revocation remain unproven.
- Packaging is still the weakest surface: a fresh machine without Python cannot run
  the Tauri shell.

### 13.5 Audit file history addendum

2026-10-20 (later) — implementation pass: Phase 0 closed, shared player, library,
analysis timeline, companion source, docs truth pass; gate 18/18; addenda to
`HANDOFF.md` §14 and this section.

### 13.6 Batches after the first pass

| Commit | Delivered | Receipt |
|---|---|---|
| `636c23b` | MIDI learn, scenes, analysis overlay, A4 readout, marker nav, low-latency mode | player tests |
| `34e1c81` | Library resume/reset, last-played, local data reset | library tests |
| `3e52dea` | Disk-aware cache budget (gate C19) | `test_disk_preflight.py` |
| `ebd7108` | Portable session export | contract test |
| `c9e0519` | Player→library promotion, seek controls, catalogue | player tests |
| `09be975` | Remappable player shortcuts | player tests |
| `5fc298a` | Dynamic port contract (Python) | `test_dynamic_port.py` |
| `6b6c369` | Studio target/backing focus | player tests |
| `caccace` | Vitest SSR player tests (gate C22) | vitest |
| `6bd187e` | Preview tuner (autocorrelation) | player tests |
| `226955d` | Shell i18n scaffold | `docs/i18n.md` |
| `175dbe1` | Library versions UI | library tests |
| `615c389` | Per-song player settings | library + SSR tests |
| `0c1d9a0` | Companion loopback host permission + engine health | addon validator |
| `2d780d6` | Queued `render` of preview settings | contract test |
| `e5c8451` | Studio chord lane | `chordLane` test |
| `2399d4e` | Model weight removal (scoped) | preflight tests |
| `41ed39d` | Compact player mode + closure assessment | SSR test |
| `a8aabb3` | Tauri dynamic port (gate C23) | cargo fmt/clippy/check |
| `bfc96a3` | Standalone PyInstaller sidecar | manual health receipt |
| `f7d60e5` | `tauri build --no-bundle` release exe | build receipt |
| `037eb63` | MSI/NSIS installers with engine payload | MSI extraction receipt |
| `27569a9` | Bundled-engine launch without Python on PATH | launch receipt |
| `49a33f6` | Studio Real-time dialog | build |
| `534a49d` | Preferences catalogue | i18n doc + SSR |
| `273e8a7` | Shell Resume card | `mostRecentSong` test |
| `8a90f98` | Analysis lane toggles | SSR |
| `b2631f5` | About quick start / what's new | SSR |
| `7517a10` | Exact-byte cache budget (gate "flake" root cause) | prefs test |
| `f7370e1` | Deterministic low-disk clamp regression | prefs test |
| `a875776` | Render job end-to-end over HTTP | API test |
| `fa1849c` | MIDI Studio shell catalogue | SSR |
| `6ea3cef` | Studio compact mode | build/typecheck |

### 13.7 Current parity status (2026-10-21)

§13.3 is the audit-time snapshot; §13.6 is the batch ledger. Read together with this
summary:

- **Implemented (N) with evidence in §13.6:** T-03 (speed + queued render), T-11
  (method labels), T-15–T-19 (A–B/ABX, count-in, markers, practice clips with
  per-clip fields, ramp), T-22 (clip sequence), T-24–T-26 (wait gate, metronome,
  loop set at playhead), T-32 (analysis lanes), T-38–T-44 (stem chord lane,
  real-time overlay, library/markers/clips/settings/versions), T-50 (resume card),
  T-57 compact part, T-60 (opt-in open player), T-69 toggle part.
- **Partial:** T-13 (granular per-stem transpose/speed/EQ + Q bake; no phase-vocoder
  per-stem engine), T-20 (layout scenes, not widget layouts), T-21 (focus crossfade,
  chords, EQ; no WebGPU), T-27 (DAW MIDI wait), T-29–T-31 (heuristics, no neural
  models), T-33 (model status/remove; no chord/beat weights), T-53–T-56 (adapters,
  capture, diagnostics, ad guard; live sites owner-run), T-63 (all surfaces
  catalogued except Studio help/messages; no RTL/plurals), T-67 (compact, no wide),
  T-71 (quick start/what's new; no tours/support).
- **N/A by local-first decision:** T-35, T-49, T-61, T-74–T-77 (cloud/web/GPU-only
  or non-goals).
- **Owner-gated:** neural chord/beat weights and licensing; trusted Authenticode
  certificate + publishing; clean-VM install/update; listening quality.

No row above is marked complete without a commit or receipt.

### QA additions (2026-10-23)

The end-to-end sweep (docs/evidence/qa-sweep-2026-10-22.md) added capability and
fixed defects beyond the original matrix:

- Reload restores the current session (`GET /api/session/current`); New session
  clears it; session notes round-trip.
- Focus traps (player modal, help sheet, palette, session dialog) with Escape from
  any control and focus restored to the trigger.
- Direct audio URL import without yt-dlp (SSRF-checked urllib + ffmpeg), named from
  the URL.
- Queue dedupes the same song; cancel is authenticated; playlist/version/clip rows
  refresh; drag-and-drop import and track reorder verified; 200% scale and 800 px
  layouts do not overflow.
- A live HTTP security probe (401/403/413/400/404/null-session) is part of the
  check set.


