# Neiro

**Local source separation, restoration, and symbolic transcription.**

*Neiro* (音色) is Japanese for **timbre** — the color of a sound. Telling timbres
apart and drawing them out of a mix is the whole job of this software. Everything
runs locally; no audio leaves the machine.

This repository currently implements **milestone M0 — the engine spine** from
[`roadmap.md`](roadmap.md): a typed-artifact DAG runtime with a content-addressed
cache, a VRAM-aware model registry driven by JSON manifests, an analysis pass, and
a working separation pipeline that needs **no model downloads** — it runs on pure
DSP out of the box. Neural backends (Demucs, BS-RoFormer, transcription models)
plug in through the same manifest interface as they are added.

---

## Status

| Area | State |
|---|---|
| Ingest (WAV/FLAC native, everything else via ffmpeg) + sample-rate lanes | ✅ working |
| DAG runtime, content-addressed cache, cooperative cancel | ✅ working |
| VRAM manager with downgrade ladder (evict → fp16 → shrink chunk → CPU) | ✅ working |
| Model registry + JSON manifests + availability probing | ✅ working |
| Analysis pass (loudness, clipping, bandwidth, mono check, tempo, key) | ✅ working |
| Separation — DSP (centre-channel, HPSS) + residual/null-test | ✅ working, no downloads |
| Separation — neural (HTDemucs adapter) | ✅ adapter present, needs `neiro[demucs]` |
| CLI (`analyze`, `separate`, `models`) | ✅ working |
| Ensembles, restoration, transcription, GUI | ⏳ roadmap M1+ |

## Install

Requires Python ≥ 3.10 and [ffmpeg](https://ffmpeg.org) on `PATH` (only needed for
compressed/video inputs; WAV/FLAC work without it).

```bash
pip install -e .
# optional neural fast-lane separator:
pip install -e ".[demucs]"
# for development:
pip install -e ".[dev]"
```

## Usage

```bash
# Inspect a file — tempo, key, loudness, clipping, bandwidth, condition flags.
neiro analyze song.flac

# Separate into vocals + instrumental (default DSP model, no download).
neiro separate song.flac --preset vocals --out stems/ --format flac

# Harmonic / percussive split.
neiro separate song.wav --preset harmonic

# 4-stem (uses HTDemucs when installed; otherwise falls back with a note).
neiro separate song.wav --preset 4stem

# See what models are registered and which are available on this machine.
neiro models
```

Every separation writes a `residual` track — `source − Σ(stems)`. Auditioning it is
the **null test**: a near-silent residual means the mix was fully accounted for; a
loud one means a stem dropped something.

## Architecture in one screen

```
ingest → lane(sr) → analyze
                 └→ separate(model) → {stems…} → residual(null test) → export
```

- **Everything is a typed artifact** (`AudioTensor`, `AnalysisReport`, `NoteStream`)
  flowing through a **DAG of nodes**. Each node is keyed in a content-addressed
  cache by `hash(inputs + config + model version)`, so re-running a job with one
  changed parameter recomputes only the affected subgraph.
- **The Planner** turns (intent, registry, hardware) into a concrete graph. The CLI
  and (future) GUI are both thin clients over it.
- **The VRAM manager** owns accelerator memory. Nothing loads a model except through
  its admission control, which applies a downgrade ladder instead of ever letting a
  CUDA OOM reach the user.
- **Models are manifests, not dependencies.** The core never imports a model repo
  directly; adapters wrap each backend behind a uniform `Separator` /
  `Transcriber` / `Enhancer` / `Analyzer` protocol.

See [`roadmap.md`](roadmap.md) for the full product and architecture design.

## Adding a model

Drop a JSON manifest into `src/neiro/manifests/` (or a user models directory) — no
core changes needed:

```json
{
  "manifest_version": 2,
  "id": "my-separator",
  "task": "separate",
  "stems": ["vocals", "instrumental"],
  "display_name": "My Separator",
  "adapter": "my_package.adapters:MySeparator",
  "requires": ["torch"],
  "quality_class": "reference",
  "vram": { "fp32_gb": 6.0, "fp16_gb": 3.2, "supports_fp16": true },
  "license": { "spdx": "MIT" }
}
```

The adapter is any class implementing the protocol in
[`neiro.nodes.base`](src/neiro/nodes/base.py). Heavy imports go inside `load()` so
the core stays importable without them.

## Development

```bash
pip install -e ".[dev]"
pytest
```

## Licensing note

The engine is MIT (see [`LICENSE`](LICENSE)). Individual **models** carry their own
licenses — several state-of-the-art separation weights are non-commercial or
research-only. Each manifest records its license; `neiro models` shows it, and it
follows model output into export metadata. Verify a model's terms before commercial
use.
