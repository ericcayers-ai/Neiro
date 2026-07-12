# Neiro

**Local source separation, restoration, transcription, and audio editing.**

[![CI](https://github.com/ericcayers-ai/Neiro/actions/workflows/ci.yml/badge.svg)](https://github.com/ericcayers-ai/Neiro/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Ruff](https://img.shields.io/badge/lint-ruff-261230)](https://github.com/astral-sh/ruff)
[![Tests](https://img.shields.io/badge/tests-74%20passing-brightgreen)](tests/)

*Neiro* (音色) is Japanese for **timbre** — the color of a sound. Telling timbres
apart and drawing them out of a mix is the whole job of this software. Everything
runs locally; no audio leaves the machine.

Neiro is built on a decoupled, graph-based engine where every neural network is a
replaceable node behind a uniform interface — so the app survives the churn of
open-source model development without rewrites. It ships with a **pure-DSP floor**
that works with **no model downloads**, and neural backends (Demucs, RoFormer,
Basic Pitch, Apollo, …) plug in through JSON manifests.

> **Scope:** this repository implements a tested, runnable slice across every phase
> of [`roadmap.md`](roadmap.md) — analysis, separation (+ensembles), restoration,
> transcription (+MIDI), a local Simple-mode interface, and a basic audio editor.
> The full neural model roster, sheet-music engraving, and learn-mode remain
> roadmap items; the architecture to host them is in place.

---

## Highlights

- **Separate** — vocals/instrumental, harmonic/percussive, or 4-stem, with a
  weighted spectral-fusion **ensemble** engine and test-time augmentation. Every
  result includes a **null-test** residual so you can hear what was left behind.
- **Transcribe** — audio → MIDI via YIN pitch tracking and note segmentation, with
  a timeline compiler that does **reversible** groove-preserving quantization
  (grid for notation, micro-offsets for feel). Auto-splits dense mixes first.
- **Restore** — declip, mains-hum removal, spectral-gate denoise, normalize —
  applied automatically as **conditioning chains** from what the analysis detects,
  or on demand.
- **Analyze** — loudness, tempo, key, clipping, bandwidth (lossy-source flag),
  effective-mono detection, mains-hum and echo/delay detection.
- **Edit** — a basic waveform + spectrogram editor (trim, delete, silence, fade,
  gain, normalize, reverse) with non-destructive undo, in the browser.
- **Local interface** — drag-and-drop Simple mode served on `127.0.0.1`, plus a
  full CLI. Both are thin clients over the same engine.

## Install

Requires Python ≥ 3.10 and [ffmpeg](https://ffmpeg.org) on `PATH` (only for
compressed/video inputs; WAV/FLAC work without it).

```bash
pip install -e .
# optional neural backends:
pip install -e ".[demucs]"       # HTDemucs 4-stem
pip install -e ".[basicpitch]"   # Spotify Basic Pitch (polyphonic transcription)
pip install -e ".[dev]"          # tests + linting
```

## Usage

```bash
neiro ui                                   # open the local interface in a browser

neiro analyze song.flac                    # tempo, key, loudness, conditions (JSON)

neiro separate song.flac --preset vocals   # vocals + instrumental (+ residual)
neiro separate song.wav  --preset vocals-ensemble   # 3-member ensemble + TTA
neiro separate song.wav  --preset harmonic          # harmonic + percussive
neiro separate song.wav  --preset 4stem             # HTDemucs when installed

neiro transcribe song.wav --out song.mid            # audio -> MIDI (auto-split)
neiro transcribe solo.wav --mode direct --no-quantize   # keep performance timing

neiro enhance old.wav                      # auto-repair from detected conditions
neiro enhance vox.wav --chain dehum,denoise,normalize   # explicit chain

neiro models                               # list models and availability here
```

## The interface

`neiro ui` opens a local, single-screen Simple mode:

1. **Drop a file** → a plain-language analysis card (duration, loudness, tempo,
   key, and any flagged conditions).
2. **Separate / Transcribe / Restore / Edit** — one click each, with honest,
   named progress.
3. **Results** — a stem mixer with players and downloads (and the null-test
   figure), a piano-roll for transcriptions synced to playback, or the audio
   editor with live waveform and spectrogram.

Nothing is exposed to the network; file serving is confined to a per-session
temporary workspace with path-traversal protection.

## How it works

```
ingest → lane(sr) → analyze
                 ├→ separate(model / ensemble) → {stems…} → residual (null test)
                 ├→ enhance(chain) → restored audio
                 └→ [split] → transcribe(model) → compile → Timeline → MIDI
```

- **Everything is a typed artifact** flowing through a **DAG of nodes**, keyed in a
  **content-addressed cache** so re-runs recompute only what changed.
- **The Planner** turns intent + analysis + hardware into a concrete graph; the CLI
  and UI are clients of it.
- **The VRAM manager** owns accelerator memory and applies a downgrade ladder
  (evict → fp16 → shrink chunk → CPU) so a CUDA OOM never reaches the user.
- **Models are manifests, not dependencies** — the core imports only numpy/scipy.

Full details: [`docs/architecture.md`](docs/architecture.md).

## Documentation

- [Architecture](docs/architecture.md) — how the engine is built
- [Adding a model](docs/adding-models.md) — manifests, adapters, ensembles
- [Performance](docs/performance.md) — RTF benchmarks and how they're achieved
- [Roadmap](roadmap.md) — the full product and architecture vision
- [Changelog](CHANGELOG.md)

## Development

```bash
pip install -e ".[dev]"
ruff check . && ruff format --check .   # lint + format (CI enforces both)
pytest                                   # 74 tests
pytest --cov=neiro                       # with coverage (~84%)
python scripts/benchmark.py              # throughput on your machine
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
| Analysis (loudness, tempo, key, clipping, bandwidth, hum, echo) | ✅ |
| Separation — DSP (centre, HPSS) + ensembles + TTA + residual | ✅ no downloads |
| Separation — neural (HTDemucs) | ✅ adapter, needs `neiro[demucs]` |
| Restoration — declip, dehum, denoise, normalize + conditioning chains | ✅ |
| Transcription — YIN (mono) + timeline compiler + MIDI export | ✅ no downloads |
| Transcription — neural (Basic Pitch) | ✅ adapter, needs `neiro[basicpitch]` |
| Audio editor — waveform + spectrogram + edits | ✅ |
| Local interface (Simple mode) | ✅ |
| Ensembles of neural models, sheet-music engraving, learn mode | ⏳ roadmap |

## Licensing note

The engine is MIT (see [LICENSE](LICENSE)). Individual **models** carry their own
licenses — several state-of-the-art separation weights are non-commercial or
research-only. Each manifest records its license; `neiro models` shows it, and it
follows model output into export metadata. See also [SECURITY.md](SECURITY.md) for
the local-first security model and the model-weight supply-chain note.
