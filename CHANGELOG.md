# Changelog

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

### Changed
- Unix launchers resolve the wheel with an absolute `$PWD` path before
  `pip install …[all]`.
- Release zip assembly fails clearly if no `neiro-*.whl` is present in `dist/`,
  and only packs the current-version wheel (avoids bundling older wheels).
- Docs / START HERE note Python 3.10–3.12 launcher support; Basic Pitch remains
  opt-in via `neiro[basicpitch]` on ≤3.11.

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
