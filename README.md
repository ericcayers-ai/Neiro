# Neiro

**Local source separation, restoration, transcription, and audio editing.**

[![CI](https://github.com/ericcayers-ai/Neiro/actions/workflows/ci.yml/badge.svg)](https://github.com/ericcayers-ai/Neiro/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Ruff](https://img.shields.io/badge/lint-ruff-261230)](https://github.com/astral-sh/ruff)
[![Tests](https://img.shields.io/badge/tests-100%2B%20passing-brightgreen)](tests/)

*Neiro* (音色) is Japanese for **timbre** — the color of a sound. Telling timbres
apart and drawing them out of a mix is the whole job of this software. Everything
runs locally; no audio leaves the machine, ever.

Neiro is built on a decoupled, graph-based engine where every neural network is a
replaceable node behind a uniform interface — so the app survives the churn of
open-source model development without rewrites. It ships with a **pure-DSP floor**
that works with **no model downloads**, and neural backends (Demucs, RoFormer,
Basic Pitch, AudioSR, Matchering, …) plug in through JSON manifests.

> **Status: Neiro 1.0.0** completes phases 1–10 / milestones M0–M7 in
> [`roadmap.md`](roadmap.md): analysis, separation (+ensembles / quality tiers),
> restoration, transcription (+MIDI/MusicXML/score), Learn with WebMIDI wait mode,
> Simple/Advanced React + Tauri worksuite, CLI, evaluation harness, and
> documentation/governance. Neural weights stay opt-in (not redistributed); full
> MUSDB/MAESTRO score tables need a provisioned eval machine. See
> [`docs/roadmap-traceability.md`](docs/roadmap-traceability.md) for the
> item-by-item ledger.

---

## Highlights

- **Separate** — vocals/instrumental, harmonic/percussive, karaoke, 4/6-stem, or
  drum-kit decomposition, with a weighted spectral-fusion **ensemble** engine and
  test-time augmentation. Every result includes a **null-test** residual so you can
  hear what was left behind.
- **Restore** — declip, mains-hum removal, spectral-gate denoise, dereverb,
  bandwidth extension (AudioSR), reference mastering (Matchering) — applied
  automatically as **conditioning chains** from what the analysis detects, or on
  demand.
- **Transcribe** — audio → MIDI. A dependency-free YIN pitch tracker covers the
  model-free floor; Basic Pitch and a piano-specific model (with pedal) upgrade
  polyphonic accuracy when installed. A timeline compiler does **reversible**
  groove-preserving quantization (grid for notation, micro-offsets for feel) and
  auto-splits dense mixes before decoding.
- **Analyze** — loudness, tempo, key, clipping, bandwidth (lossy-source flag),
  effective-mono detection, mains-hum and echo/delay detection, heuristic
  instrument hints.
- **Edit** — a waveform + spectrogram Studio (trim, delete, silence, fade, gain,
  normalize, reverse) with non-destructive undo.
- **Mix & practice** — a stem mixer with mute/solo/gain preview, A/B, and null-test
  audition; a Learn module with pitch-preserving speed control, loop regions, and a
  step/WebMIDI wait mode for the transcribed result.
- **Two ways in, one engine** — a Tauri 2 + React desktop app, or a full CLI and
  Python API. Every surface is a thin client over the same graph-based engine; the
  desktop app's UI is served by the local engine itself, so the browser-based
  worksuite and the desktop window show exactly the same thing.

## Install

### Desktop app (Windows / macOS / Linux)

The desktop app is a small Tauri shell that supervises a local Python engine
process on `127.0.0.1`; it needs a Python 3.10–3.12 interpreter available on the
machine (the one-click launchers below bootstrap that for you if you don't want to
manage Python yourself).

- **One-click launchers** (`packaging/launchers/`) — `Neiro UI.bat` (Windows) or
  `neiro-ui.sh` (macOS/Linux) create an isolated virtual environment next to the
  extracted release, install the bundled wheel with the neural extras, and launch
  the UI. Get them from a [release](https://github.com/ericcayers-ai/Neiro/releases)
  zip; see `packaging/launchers/START HERE.txt`.
- **Built desktop bundle** — release artifacts include native installers
  (`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.AppImage`/`.deb` on Linux)
  produced by `tauri build`, for users who already have Python set up and just want
  the app icon.
- **From source** — see [Development](#development) below;
  `npm install && npm run tauri:dev` runs the desktop shell against a live engine.

### CLI / Python package

```bash
pip install -e .
# optional backends:
pip install -e ".[all]"          # separation, piano, restoration, loudness, HF hub, yt-dlp
pip install -e ".[demucs]"       # HTDemucs 4-stem
pip install -e ".[basicpitch]"   # Spotify Basic Pitch — Python ≤3.11 only (needs TensorFlow <2.15.1)
pip install -e ".[superres]"     # AudioSR — Python ≤3.11 only
pip install -e ".[youtube]"      # YouTube / URL ingest (yt-dlp)
pip install -e ".[dev]"          # tests + linting
```

Requires Python ≥ 3.10 (3.10–3.12 supported for the core and `[all]` extras) and
[ffmpeg](https://ffmpeg.org) on `PATH` (for compressed/video inputs and URL ingest;
WAV/FLAC work without it).

`[all]` intentionally omits `basicpitch` and `superres` so one-click / wheel
installs succeed on Python 3.12. Install those extras separately on 3.10 or 3.11.

## Usage

```bash
neiro ui                                   # open the local interface (browser or desktop shell)

neiro ingest "https://youtu.be/…"          # download audio to local cache (needs [youtube])
neiro analyze song.flac                    # tempo, key, loudness, conditions (JSON)
neiro analyze "https://youtu.be/…"         # same, after fetching the URL

neiro separate song.flac --preset vocals   # vocals + instrumental (+ residual)
neiro separate song.wav  --preset vocals-ensemble   # 3-member ensemble + TTA
neiro separate song.wav  --preset harmonic          # harmonic + percussive
neiro separate song.wav  --preset 4stem             # HTDemucs when installed

neiro transcribe song.wav --out song.mid            # audio -> MIDI (auto-split)
neiro transcribe solo.wav --mode direct --no-quantize   # keep performance timing

neiro enhance old.wav                      # auto-repair from detected conditions
neiro enhance vox.wav --chain dehum,denoise,normalize   # explicit chain

neiro models                               # list models and availability here
neiro download <model-id>                  # fetch a model's weights ahead of time
neiro watch ./inbox --out ./done --job separate --preset vocals   # batch-process a folder
```

Transcription also exports MusicXML, ASCII tablature, and LRC lyrics alongside
MIDI (dependency-free writers; a MuseScore/Verovio install upgrades the score
export to a real engraved PDF) — see
[`src/neiro/symbolic/`](src/neiro/symbolic/) and
[`docs/adding-models.md`](docs/adding-models.md) for the transcription export
pipeline.

## The interface

`neiro ui` opens the local worksuite — in a browser, or as the native window when
you're running the desktop build. Processing always stays on this machine.

1. **Import** a file or URL → **Analysis** report (duration, loudness, tempo, key,
   flagged conditions with why they matter).
2. **Separate / Restore / Transcribe** — labeled presets with intent copy and
   honest, named progress (cancel works).
3. **Mixer** — mute/solo/gain preview, A/B, null test, Open in Studio per stem.
4. **Studio** — waveform + spectrogram editor (selection, edits, undo/redo,
   keyboard shortcuts, WAV/FLAC export).
5. **Learn** — pitch-preserving practice speed, loop regions, count-in/metronome,
   and step or WebMIDI wait-mode over a transcription result.
6. **Preferences** — theme, density, font scale, motion, cache budget, warm-pool
   TTL; a privacy panel that states plainly what does and doesn't touch the network.

Dev: `npm --prefix frontend run build` (or Vite with a running engine). Desktop:
`npm run tauri:dev` from the repo root.

Nothing is exposed to the network; the interface binds to `127.0.0.1` only, and
file serving is confined to a per-session temporary workspace with path-traversal
protection.

## How it works

```
ingest → lane(sr) → analyze
                 ├→ separate(model / ensemble) → {stems…} → residual (null test)
                 ├→ enhance(chain) → restored audio
                 └→ [split] → transcribe(model) → compile → Timeline → MIDI
```

- **Everything is a typed artifact** flowing through a **DAG of nodes**, keyed in a
  **content-addressed cache** so re-runs recompute only what changed.
- **The Planner** turns intent + analysis + hardware into a concrete graph; the CLI,
  the desktop app, and the browser worksuite are all clients of it.
- **The VRAM manager** owns accelerator memory and applies a downgrade ladder
  (evict → fp16 → shrink chunk → CPU) so a CUDA OOM never reaches the user.
- **Models are manifests, not dependencies** — the core engine imports only
  numpy/scipy; the desktop shell is a small Rust binary that supervises the Python
  engine process and renders its UI.

Full details: [`docs/architecture.md`](docs/architecture.md).

## Documentation

- [Architecture](docs/architecture.md) — how the engine and desktop shell are built
- [Model registry](docs/models.md) — the shipped manifests, licenses, and how to fetch weights
- [Adding a model](docs/adding-models.md) — manifests, adapters, ensembles
- [UI](docs/ui.md) — desktop shell, worksuite modules, design language
- [Session format](docs/session.md) — provenance, caching, and reproducibility
- [Plugins](docs/plugins.md) — the manifest-based extension points and their trust boundaries
- [Performance](docs/performance.md) — RTF benchmarks and how they're achieved
- [Evaluation](docs/evaluation.md) — the quality/testing harness and how to run it
- [Roadmap](roadmap.md) — the full product and architecture vision
- [Roadmap traceability](docs/roadmap-traceability.md) — requirement-by-requirement status
- [Changelog](CHANGELOG.md)

## Development

```bash
# Python engine
pip install -e ".[dev]"
ruff check . && ruff format --check .   # lint + format (CI enforces both)
pytest                                   # tests
pytest --cov=neiro                       # with coverage
python scripts/benchmark.py              # throughput on your machine
python scripts/verify_models.py          # sanity-check every manifest

# Frontend
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run build

# Desktop shell (Rust/Tauri)
cd src-tauri && cargo fmt --all && cargo clippy --all-targets && cargo check
npm run tauri:dev                        # from the repo root
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The
lowest-friction contribution is a new model: a manifest plus a small adapter, no
core changes ([guide](docs/adding-models.md)).

## Status

| Area | State |
|---|---|
| Ingest + sample-rate lanes, DAG runtime, content cache | ✅ |
| VRAM manager with downgrade ladder | ✅ |
| Registry + JSON manifests + availability probing | ✅ |
| Analysis (loudness, tempo, key, clipping, bandwidth, hum, echo, heuristic instruments) | ✅ |
| Separation — DSP (centre, HPSS) + ensembles + TTA + residual | ✅ no downloads |
| Separation — neural (HTDemucs, RoFormer, MDX23C, karaoke, drumsep, …) | ✅ adapters + manifests |
| Restoration — declip, dehum, denoise, dereverb + conditioning chains | ✅ |
| Restoration — neural (AudioSR super-resolution, Matchering mastering) | ✅ adapters |
| Transcription — YIN (mono) + timeline compiler + MIDI export | ✅ no downloads |
| Transcription — neural (Basic Pitch, piano with pedal) | ✅ adapters |
| Audio editor (Studio) — waveform + spectrogram + edits | ✅ |
| Desktop shell (Tauri 2 + React worksuite) with engine health supervision | ✅ |
| Mixer (A/B, null test, Open in Studio), Learn module UI, Preferences UI | ✅ UI; deeper wiring (WebMIDI, playback speed engine) in progress |
| Disk-backed artifact cache, export license sidecars | ✅ |
| Symbolic export — MusicXML, ASCII tab, LRC lyrics, best-effort engraved PDF/SVG | ✅ dependency-free writers; real engraving PDF needs Verovio/MuseScore on `PATH` |
| Portable session format (provenance, model pinning, checkpoints) | ✅ format + store; not yet wired into the UI's save/open flow |
| Watch-folder batch daemon (`neiro watch`) | ✅ |
| Bleed suppression, mid/side stereo-integrity helpers | ✅ DSP primitives + tests; not yet auto-inserted by the planner |
| Signed model index verification | ✅ HMAC sign/verify helpers; registry doesn't fetch a remote index yet |
| Evaluation harness — synthetic goldens (SDR/SI-SDR/F1) + fault injection, always in CI | ✅ |
| Evaluation harness — full MUSDB18-HQ / MAESTRO runs | ⏳ requires user-provisioned datasets (see [docs/evaluation.md](docs/evaluation.md)) |
| Sheet-music *in-app* rendering, Advanced mode pipeline editor | ⏳ deferred (roadmap) |

## Licensing note

The engine, desktop shell, and frontend are MIT (see [LICENSE](LICENSE)).
Individual **models** carry their own licenses — several state-of-the-art
separation weights are non-commercial or research-only. Each manifest records its
license; `neiro models` shows it, and it follows model output into export
metadata. See [docs/models.md](docs/models.md) for the full registry and
[SECURITY.md](SECURITY.md) for the local-first security model and the
model-weight supply-chain note.
