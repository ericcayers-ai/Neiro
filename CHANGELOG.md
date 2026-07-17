# Changelog

## 1.2.1 — DAW shell + pipeline matrix (2026-07-18)

### Added
- `scripts/matrix_youtube_song.py` — full UI-registry matrix (Separate × quality, Restore + neural steps, Transcribe) with `needs-install` honesty; YouTube fixture ingest path
- Cancellable **`pitch_correct` job** (`POST /api/pitch_correct`) with stage logs; Studio JobProgress + Cancel
- Studio **Reset to original** (edit parent chain); `GET /api/file/<id>/parent`
- Icon undo/redo/reset/pencil/erase; denser icon rail when collapsed; Studio/MIDI DAW chrome strip

### Changed
- Planner enhance path downloads when `auto_download` (no silent skip of undownloaded neural steps)
- MIDI ensemble: `needs-download` members selectable + auto-download on Transcribe (install-only stays Prefs)
- Live scrub / playhead (Studio + MIDI) without pause→play stutter; gap hold via `timelineToMediaHold`

## 1.2.0 — Studio / MIDI mashup overhaul (2026-07-17)

Waves 1–5 of the Studio + MIDI Studio + analysis roadmap: mashup packs, unified
MIDI Studio, chrome/icons, restore/analysis polish, transcription UX, pitch
correct, and session persistence.

### Added
- **MIDI Studio** module (replaces Transcribe + Learn): Transcribe / Roll /
  Roll+score / Edit / Practice; soundfont audition; Verovio score + PDF path;
  Rubber Band practice speed; shortcut `6` (Practice via `8`)
- Studio **mashup packs**: multi-song stem packs, BPM align + key transpose,
  beat snap, stem identity badges, bounce pack/selection
- Prefs **Models packs** + **Tools** (Install Verovio, MuseScore path/link,
  Soundfont download)
- Studio pitch-correct job, clip context menu, spectrogram lane
- Collapsible chrome (rail / jobs / plan / logs) to chevron-only; shared icon set
- Windows subprocess helper (`CREATE_NO_WINDOW`) for ffmpeg / MuseScore / adapters
- Analysis corrections draft autosave; Restore layman presets + detector why-text
- Separate grouped presets + “Send stems to Studio” / “Add as mashup pack”

### Changed
- Job progress poll ~400ms while running; denser stage→fraction mapping
- Studio timeline↔media mapping (offset/range), loop selection-only, live pan
- Plan strip / DAG preview consumes analysis corrections
- About + Studio `?` shortcuts: Windows **Ctrl** primary, ⌘ secondary
- Session Save/Open persists stem packs, MIDI Studio state, and **Studio track/clip timeline**
- Studio Open remounts timeline while Studio is already open (`neiro:studio-tracks` event)
- Separate batch pack queue drains without dropping intents when the active file changes

### Fixed
- Prefs GM SF2 install was a dead gate for MIDI piano — now verifies SF2 URL then unlocks FluidR3 browser kit
- Empty CLI window flashes on Windows helper subprocesses (incl. Verovio pip install)
- Loop restarting from whole-track start when a selection was active
- UI scaling / overflow on resize (`min-width: 0`, rem shell spacing)
- Job tray not user-resizable; MuseScore had no path browse/set; no multi-import Separate batch
- About shortcuts mislabeled modules; empty “No file” gates left-aligned on wide layouts; dropzone helper text too faint

## 1.1.1 — UI navigation QOL (2026-07-17)

Product-shell polish for easier navigation and lower cognitive load, plus CI
fixes inherited from main.

### Added
- Command palette (`Ctrl/⌘K`) for module jump and common actions
- Collapsible module rail (`Ctrl/⌘B`) with shortcut digits
- Session Save/Open dialogs (replacing `prompt()`)
- Shared `ModuleHeader` / `EmptyGate` patterns across modules
- `PRODUCT.md` + `DESIGN.md` design context

### Changed
- Shorter module copy; progressive disclosure for advanced Separate/Transcribe options
- Mobile horizontal scroll module strip; collapsible job tray
- Spacing / z-index / motion tokens; stronger primary button affordance

### Fixed
- Ruff import/unused-import and format drift blocking CI
- Rustfmt on Tauri engine log helper
- Ensemble member checks accept `model_id` references (`tr-ensemble-default`)

## 1.1.0 — DAW all-modes, full zoo, roadmap close-out (2026-07-16)

QOL / QA / function / aesthetic overhaul on top of 1.0.0: CI green, shared-window
DAW injectors for every mode with Edison-style capture, full model-zoo wiring,
and MVP close-outs for remaining roadmap surfaces.

### Added
- Shared-window **DAW VST2 injector** + **CLAP/VST3 bridge crate** (`plugins/neiro-vst`,
  `plugins/neiro-clap`): Target Mode for every worksuite module; Record →
  `/api/daw/capture` Edison-style upload; MIDI → Learn; Open UI focuses one window
- Full roadmap **model zoo** (~68 manifests): BS-RoFormer SW/1296, Mel Kim/FT,
  MDX-B/VR karaoke, Demucs MMI, Kuielab isolators, woodwinds/crowd, aspiration,
  VR denoise/dereverb/de-echo, bleed, VoiceFixer, YourMT3, SVT, TimbreAMT,
  Noise-to-Notes, LarsNet, SCNet-XL; planner presets + enhance steps
- **CLAP analyze** adapter (`an-clap`) for neural instrument tags (DSP floor remains)
- **User Python plugins** scan (`~/.neiro/plugins`) with grant API
- **Plan strip** (`GET /api/plan`) + Advanced UI DAG preview
- **WebGL2** Studio / piano-roll drawing with Canvas2D fallback
- **Arrow IPC** bulk waveform path (`/api/bulk/waveform`) with JSON fallback
- **In-app score SVG** on transcription results (Verovio when available)
- **Piano-roll note CRUD** (`/api/notes/<job>`)
- **Session Save/Open** UI + `/api/session/*`
- **Compute flush** `/api/compute` wired from Prefs
- Reference-lyric **greedy aligner** (`neiro.symbolic.lyric_align`) for Whisper words
- About → Check for updates (GitHub Releases; no telemetry)

### Changed
- Separate quality tier + bleed suppression are sent to the engine (no more
  `preset:tier` string hack)
- DAW connection unlocks the full module rail in Simple mode
- Learn copy honestly labels browser `playbackRate` vs pitch-preserving stretch;
  metronome clicks via Web Audio
- Docs/install scripts updated for all-modes DAW + CLAP path
- Aesthetic polish within existing ink-on-slate / IBM Plex tokens (plan strip,
  recording pill, session bar)

### Fixed
- CI: Ruff SIM105 (`contextlib.suppress`) + format on DAW bridge
- CI: unused `@ts-expect-error` breaking frontend typecheck

### Notes / external requirements
- Restricted neural weights are **not** bundled; install extras and download per
  manifest licenses
- True MFA phoneme alignment still requires an external AM; reference-text
  aligner ships as the local MVP
- Desktop auto-update remains GitHub Releases–driven (Check for updates in About)

## 1.0.0 — Full roadmap product (2026-07-16)

Completes the Neiro 1.0 program across phases 1–10 / milestones M0–M7: engine
foundations, analysis intelligence, separation & restoration roster, transcription
orchestration & symbolic exports, Simple/Advanced React worksuite, plugins &
performance backends, evaluation harness, and documentation/governance.

### Added
- Portable sessions, job checkpoints, watch-folder batch CLI, signed model index helpers
- Memory-mapped ingest path, safer versioned cache, WebSocket JSON-RPC control helpers
- Analysis report v2: chords, sections, downbeats, RT60 heuristic, capability notes, user corrections
- Quality tiers (Draft/Standard/Reference), detect-all & cinematic presets, bleed suppression, mid/side stereo helpers
- Manifests/adapters for SCNet, Medley Vox, Apollo, DeepFilterNet, SonicMaster (opt-in checkpoints; licenses surfaced)
- Decoder router, hybrid orchestration, MusicXML/tablature/LRC/score export, DAWproject zip
- Learn + Preferences modules (WebMIDI wait mode); Simple/Advanced workspace; mixer shared transport; Studio undo remount
- Health/version API, Tauri CSP + sidecar health/restart, expanded CI (Python/frontend/Rust/packaging)
- Evaluation harness: >=30 synthetic goldens, PEAQ/ViSQOL-class perceptual proxy, human listening protocol, MUSDB/MAESTRO/extra-corpora runners
- Desktop release workflow: Python wheel/sdist + per-OS Tauri installers
- Governance: SUPPORT, CODE_OF_CONDUCT, CONTRIBUTING, expanded issue templates, Dependabot

### Changed
- Version **1.0.0** across Python, npm, frontend, and Tauri packages
- Roadmap ledger updated to 1.0 completion status (see `docs/roadmap-traceability.md`)

### Notes / external requirements
- Restricted neural weights are **not** bundled; install extras and download per manifest licenses
- Full MUSDB18 / MAESTRO score publication requires provisioning datasets via `NEIRO_EVAL_*` env vars
- Cross-platform signed installers are produced by release workflows on each OS runner

## 0.4.0 — UI worksuite (2026-07-14)

Replaces the single-file Simple UI with a Tauri 2 + React + TypeScript worksuite:
module rail, labeled engine controls, Audacity-like Studio, and Mixer — still driven
by the local Python HTTP engine on `127.0.0.1`.

### Added
- **React worksuite** (`frontend/`): Import, Analysis, Studio, Separate, Restore,
  Transcribe, Mixer, About — ink-on-slate tokens (IBM Plex), intent helpers on every
  control, sticky session bar, `localStorage` preset memory, module shortcuts 1–7.
- **Studio**: stacked waveform + spectrogram, zoom/pan/scrub, selection, labeled edit
  ops, undo/redo, keyboard shortcuts, export (`wav16` / `wav24` / `flac`).
- **Mixer**: mute/solo/gain preview, A/B, null test, Open in Studio (stem `file_id`).
- **API**: `GET /api/export`, waveform `start`/`end` zoom window; SPA static serve from
  `ui/static/`; stem/restore results include `file_id` for Studio.
- **Tauri 2 shell** (`src-tauri/`): spawns `python -m neiro.cli ui --no-browser`, loads
  the local UI, tears down the sidecar on quit.
- Launchers prefer `Neiro.exe` / `Neiro` / `Neiro.app` when present beside the script.

### Changed
- Vanilla `index.html` Simple mode retired (short build notice remains as fallback).
- Package data includes `ui/static/**` for wheel packaging.

### Notes
- Dev: `neiro ui --no-browser` + `npm --prefix frontend run dev` (Vite proxies `/api`).
- Or build UI once: `npm --prefix frontend run build`, then `neiro ui`.
- Desktop: `npm install` at repo root, then `npm run tauri:dev` / `tauri:build`.

## 0.3.3 — Windows launcher + Python 3.12 extras (2026-07-14)

Critical fixes for the one-click Windows launchers and for Python 3.12 users:
first-run `pip install` of the bundled wheel no longer expands to a bare
`[all]` requirement, and `[all]` no longer pulls TensorFlow via `basic-pitch`.

### Fixed
- **Windows launcher install**: `Neiro UI.bat` / `Neiro CLI.bat` install the
  wheel from inside the `for` loop via `%%~ff[all]` (absolute path). Previously,
  `%NEIRO_WHL%` was expanded at parse time inside an `if` block and was empty,
  so pip saw only `[all]` and failed with `Invalid requirement`.
- **Python 3.12 `[all]` install**: `basic-pitch` removed from the `all` optional
  dependency group. It pins `tensorflow<2.15.1` (not published for 3.12), which
  aborted `pip install …[all]` on 3.12. Use `neiro[basicpitch]` on Python ≤3.11.
- **Windows torch script race** (`WinError 2` on `torchfrtrace.exe.deleteme`):
  launchers now run `install_neiro.py`, which installs torch first with
  `--no-cache-dir`, uses a local `%LOCALAPPDATA%\neiro-pip-tmp`, retries on
  file-lock failures, and only then installs `neiro[all]`.

### Changed
- Unix launchers resolve the wheel with an absolute `$PWD` path before
  `pip install …[all]`.
- Release zip assembly fails clearly if no `neiro-*.whl` is present in `dist/`,
  and only packs the current-version wheel (avoids bundling older wheels).
- Docs / START HERE: extract to `C:\Neiro`, delete `.venv` on failed setup;
  Basic Pitch remains opt-in via `neiro[basicpitch]` on ≤3.11.

## 0.3.2 — roadmap parity, URL ingest (2026-07-14)

Patch release aligning the roadmap ledger with shipped functionality, tightening
CLI/UI parity, and adding optional YouTube/URL ingest via yt-dlp.

### Added
- **URL ingest** (`neiro[youtube]`): `neiro ingest <url>` downloads audio with
  yt-dlp; `analyze`, `separate`, `transcribe`, and `enhance` accept URLs directly.
  Local UI has a paste-and-fetch field (`POST /api/ingest-url`). Cached under
  `NEIRO_HOME/url-ingest`.
- **Restore UI parity**: Matchering reference mastering option in the local UI
  restore chain (already available in CLI as `master`).

### Changed
- **Roadmap ledger** updated to v0.3.2: honest status for every alpha-shipped
  model manifest (BS-RoFormer, MDX23C, HTDemucs, Mel-RoFormer, karaoke, drumsep,
  denoise/dereverb RoFormer, AudioSR, Matchering, Basic Pitch, piano
  transcription) versus intentionally deferred research targets (Apollo, Transkun,
  SCNet-XL, MIROS, …).

## 0.3.1 — alpha roadmap completion, launcher fix (2026-07-14)

Patch release closing the remaining alpha roadmap gaps and fixing one-click
launcher bootstrap when a `.venv` already exists without Neiro installed.
87 tests pass; core DSP still runs with no model downloads.

### Fixed
- **Launcher bootstrap**: Windows `.bat` and Unix shell launchers now install
  Neiro from the bundled wheel when the venv exists but `import neiro` fails
  (previously skipped install after venv creation).

### Added
- **Chunked separation** (`neiro.dsp.chunking`): VRAM-aware overlap-add with
  `chunk_scale` wired through the planner and graph runtime.
- **Instrument detection** in analysis reports (heuristic bass/drums/guitar/piano
  hints with confidence and status).
- **Neural vocals ensemble** manifest (`sep-vocals-neural-ensemble.json`).
- **Disk cache** layer on the content-addressed artifact cache.
- **Export metadata sidecars** (`.meta.json`) alongside written stems.
- **UI parity**: job cancel API, stem mixer A/B and null audition in the local
  interface; honest alpha completion ledger in `roadmap.md`.

## 0.3.0 — neural model expansion, downloader, packaging (2026-07-13)

Major expansion of the neural backend layer: state-of-the-art separation,
enhancement, and transcription models plug in through manifests and adapters,
with a unified download manager and one-click release packaging. All additions
are tested (83 tests) and the core engine still runs with no model downloads.

### Added — neural backends & manifests
- **Audio Separator adapter** (`neiro[separation]`): BS/Mel-RoFormer, MDX23C,
  HTDemucs (6-stem + fine-tuned), karaoke, drumsep — each as a JSON manifest
  with quality tiers and license metadata.
- **Enhancement adapters**: Mel-Band RoFormer denoise/dereverb (`enh-denoise-roformer`,
  `enh-dereverb-roformer`), AudioSR super-resolution (`neiro[superres]`),
  Matchering reference mastering (`neiro[restoration]`).
- **Piano transcription adapter** (`neiro[piano]`): Kong/ByteDance piano model
  with pedal via `piano_transcription_inference`.
- **Model downloader** (`neiro.engine.downloader`): HTTP (resume + SHA-256) and
  Hugging Face Hub transports; unified `NEIRO_HOME` storage outside cloud-sync
  folders; `managed` kind for libraries that self-cache on first load.
- **CLI**: `neiro download` to fetch weights ahead of time; expanded `neiro models`
  output with download status and license info.

### Added — packaging
- **Release builder** (`packaging/build_release.py`): wheel + sdist + launcher zip;
  optional PyInstaller standalone exe (`--exe`) for the model-free core.
- **One-click launchers** (`packaging/launchers/`): Windows `.bat` and Unix shell
  scripts that bootstrap a local venv and install the wheel with the full neural
  stack on first run.
- **Optional dependency groups** in `pyproject.toml`: `separation`, `piano`,
  `restoration`, `superres`, `downloader`, and an `all` bundle.

### Changed
- Registry and planner route neural manifests by availability and quality tier;
  `htdemucs.json` replaced by granular `sep-htdemucs-*` manifests.
- Analysis report and CLI updated for the expanded model catalog.

## 0.2.0 — separation ensembles, restoration, transcription, editor (2026-07-12)

A large expansion across every roadmap phase, plus a full repository-health pass.
All additions are tested (74 tests, ~84% coverage) and run with no model downloads.

### Added — engine capabilities
- **Ensemble separation & TTA** (`neiro.dsp.ensemble`): weighted complex-spectrogram
  fusion (`mean`/`median`/`max`/`min`) with phase from the top-weighted member, and
  test-time augmentation (polarity/channel-swap). Ensembles are themselves manifests
  (`EnsembleSeparator`) — the `vocals-ensemble` preset ships a 3-member azimuth stack.
- **Restoration engine** (`neiro.dsp.enhance`): cubic-spline de-clip, zero-phase
  harmonic hum-notch cascade, spectral-gate denoise, peak normalize — as an
  `Enhancer` node family with a planner that builds **conditioning chains** from
  detected conditions (roadmap §6.2).
- **Transcription engine** (`neiro.dsp.pitch`): YIN f0 tracking (CMNDF + parabolic
  interpolation), spectral-flux onsets, and note segmentation → `NoteStream`.
- **Symbolic layer** (`neiro.symbolic`): timeline compiler with **reversible**
  groove-preserving quantization (grid + stored micro-offsets), cross-stream
  dedup/merge, and a dependency-free **Standard MIDI File** writer.
- **Auto-split orchestration**: transcription separates the centre stem first on
  wide-stereo material, then decodes the isolated stem (roadmap §8.1).
- **Analysis upgrades**: mains-hum detection (50/60 Hz + harmonics) and discrete
  echo/delay detection via envelope autocorrelation.
- **Audio editor** (`neiro.dsp.edit`, `neiro.dsp.visual`): non-destructive trim,
  delete, silence, fade, gain, normalize, reverse; per-pixel waveform peaks and a
  quantised log-frequency spectrogram for the UI.

### Added — interfaces
- **Local web interface** (`neiro ui`): drag-and-drop Simple mode on `127.0.0.1`
  with analysis card, separate/transcribe/restore jobs, stem mixer, piano-roll, and
  the waveform+spectrogram **editor** — all over the same engine as the CLI.
- **CLI commands**: `transcribe`, `enhance`, `ui` (joining `analyze`, `separate`,
  `models`); new `vocals-ensemble` preset.
- **Optional backends**: Basic Pitch adapter (`neiro[basicpitch]`) for polyphonic
  transcription.

### Added — repository health
- **CI** (GitHub Actions): lint + format + test matrix across Ubuntu/macOS/Windows
  and Python 3.10–3.12 with coverage; a tag-triggered release workflow.
- **Tooling**: Ruff lint + format config, coverage config, `py.typed` marker.
- **Docs**: `docs/architecture.md`, `docs/adding-models.md`, `docs/performance.md`,
  and a runnable `scripts/benchmark.py` (RTF measurements).
- **Community & security**: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates, and Dependabot.

### Changed
- Availability probing now checks a manifest's declared `requires` via `find_spec`,
  so backends missing their deps are listed but correctly marked unavailable and the
  planner routes around them.

## 0.1.0 — M0: engine spine (2026-07-12)

First tagged release. Implements milestone **M0 — Spine** from `roadmap.md`: a
usable, tested engine and CLI that separate audio with no model downloads.

### Added
- **Engine core**
  - Typed artifacts: `AudioTensor`, `AnalysisReport`, `NoteEvent`/`NoteStream`,
    with content-fingerprint hashing for cache keying.
  - DAG runtime (`Graph`/`Node`) with topological execution, partial (target)
    execution, cooperative cancellation, and structured progress reporting.
  - Content-addressed LRU artifact cache — re-runs recompute only changed subgraphs.
  - VRAM manager with device detection and a downgrade ladder
    (evict idle → fp16 → shrink chunk → CPU fallback) so a CUDA OOM never surfaces.
  - Model registry driven by JSON manifests, with dependency-aware availability
    probing and quality-tier-aware model selection.
  - Planner that assembles separation graphs from named presets.
- **DSP separation (no downloads)**
  - Frequency-domain centre-channel extraction (vocals / instrumental proxy).
  - Median-filtering HPSS (harmonic / percussive).
  - Exact time-domain residual / null-test node.
  - Custom STFT/ISTFT with COLA-correct overlap-add reconstruction.
- **Analysis pass**: integrated-loudness estimate, peak, clipping ratio, spectral
  bandwidth (lossy-source flag), stereo-width / effective-mono detection,
  onset-autocorrelation tempo, Krumhansl-Schmuckler key estimation.
- **Ingest/export**: libsndfile for WAV/FLAC/OGG, ffmpeg for compressed/video
  inputs, polyphase sample-rate lanes; WAV/FLAC export at 16/24/32-bit.
- **Adapters**: DSP separators (built-in) and an optional HTDemucs backend
  (`neiro[demucs]`, imports torch lazily).
- **CLI**: `neiro analyze`, `neiro separate`, `neiro models`.
- Test suite (19 tests) covering DSP reconstruction, cache memoisation, graph
  ordering/cycles, the VRAM downgrade ladder, and the end-to-end pipeline.

### Not yet implemented (see roadmap M1+)
Ensemble separation, neural instrument/vocal-condition detection, restoration
(Apollo/AudioSR), transcription, the timeline compiler, and the desktop GUI.
