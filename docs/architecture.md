# Architecture

This document describes how the engine is put together. It complements
[`roadmap.md`](../roadmap.md) (the product vision) by explaining the code that
exists today.

## One sentence

Everything is a **typed artifact** flowing through a **DAG of nodes**, scheduled
by a runtime that **caches by content**, with models loaded through a
**VRAM-aware registry** so nothing is a hard dependency.

## Layers

```
Desktop shell (src-tauri, Rust)         Browser
  spawns + supervises the engine  ─┐        │
                                    ▼        ▼
                          Frontend (frontend/, React + TS)
                                    │  fetch("/api/...")
                                    ▼
CLI (neiro.cli)  ·  Local HTTP UI (neiro.ui.server)  ·  Python API
        \                |                 /
              Planner (neiro.engine.planner)
                         |
        Graph runtime (neiro.engine.graph) + Cache
                         |
   Nodes (neiro.nodes) ──> Adapters (neiro.adapters)
                         |
   DSP (neiro.dsp)  ·  Analysis  ·  Symbolic  ·  I/O
```

The Python engine is the single source of truth. The desktop shell and the
browser worksuite are two presentations of the *same* local HTTP API
(`neiro.ui.server`) — there is no separate "desktop" business logic. See
[Desktop shell & frontend](#desktop-shell--frontend) below and
[`docs/ui.md`](ui.md) for the module-level tour.

### Artifacts (`neiro.engine.artifacts`)

Every value that moves between nodes is an `Artifact`:

- `AudioTensor` — `(channels, frames)` float32, a sample rate, and a provenance
  tuple. Hashes by a cheap fingerprint (shape + rate + a strided byte sample) so
  the cache can detect change without hashing hundreds of MB.
- `AnalysisReport` — the analysis pass output (loudness, tempo, key, conditions).
- `NoteEvent` / `NoteStream` — transcription in absolute (float-second) time.
- `Timeline` — compiled multi-track symbolic output with a stored micro-offset
  layer that makes quantization reversible.

Artifacts are immutable (frozen dataclasses). Operations return new ones — this
is what makes processing non-destructive.

### Graph runtime (`neiro.engine.graph`)

A `Graph` is a set of `Node`s linked by named `(node_id, port)` edges. Execution
is topological and deterministic. Two properties matter:

1. **Partial execution.** `execute(targets=[...])` runs only a target's transitive
   ancestors. Separating and later transcribing the same file reuses the ingest
   and lane nodes.
2. **Content-addressed caching.** Each node's result is keyed on
   `hash(node_id + config_repr + input content-keys)`. Re-running with one changed
   parameter recomputes only the affected subgraph. Verified by
   `test_cache_reuse_across_runs`.

Progress is reported through a callback (`ExecutionContext.report`) with real
stage names; cancellation is cooperative.

### VRAM manager (`neiro.engine.vram`)

The single owner of accelerator memory. `reserve()` runs admission control and a
**downgrade ladder** — evict idle models → drop to fp16 → shrink chunk size →
fall back to CPU — so a CUDA OOM never reaches the user, only a slower path with
a stated reason. On machines without a GPU it models a CPU device so the rest of
the engine behaves identically. Detection uses `torch` if present but never
requires it.

### Registry & manifests (`neiro.engine.registry`)

Models are JSON manifests scanned from a directory. A manifest names an
`adapter` as `module:Class`; the registry imports and instantiates it on demand.
`available()` checks both that the adapter imports *and* that the manifest's
declared `requires` modules are present — so a Demucs manifest on a torch-less
machine is listed but correctly marked unavailable, and the planner picks a
different model instead of failing at load time.

### Adapters (`neiro.nodes.base`, `neiro.adapters`)

Four protocols — `Separator`, `Transcriber`, `Enhancer`, `Analyzer` — wrap every
model behind a uniform interface. The engine never imports a model repository;
it sees a protocol. Heavy dependencies are imported lazily inside `load()`, so
`import neiro` pulls in nothing but numpy/scipy. Ensembles are themselves
adapters (`EnsembleSeparator`) that reference other adapters — so an ensemble is
just another manifest.

### Planner (`neiro.engine.planner`)

Turns intent into a concrete graph. `plan_separation`, `plan_transcription`, and
`plan_enhancement` each emit a `Graph` plus the target nodes. This is the one
place that encodes policy: auto-split (transcription separates first when the mix
warrants it), conditioning chains (enhancement inserts declip/dehum from detected
conditions), and quality-tier model selection. The CLI and UI are thin clients
over the planner.

## Data flow examples

**Separation** (`neiro separate x.wav --preset vocals`):

```
ingest → lane(44.1k) → separate(dsp-center) → {vocals, instrumental}
                    └→ residual (null test)
```

**Transcription with auto-split** (stereo, dense):

```
ingest → analyze
      └→ seplane → split(center) → lane(16k mono) → transcribe(yin) → compile → Timeline → MIDI
```

**Enhancement conditioning chain** (clipping + hum detected):

```
ingest → enhance(declip) → enhance(dehum) → restored audio
```

## The model-free floor

Every node family has a pure-DSP implementation that needs no downloads:

| Family | DSP floor | Neural upgrade (optional) |
|--------|-----------|---------------------------|
| Separate | centre extraction, HPSS, ensembles + TTA | HTDemucs, RoFormer, … |
| Transcribe | YIN + note segmentation (monophonic) | Basic Pitch, Transkun, … |
| Enhance | declip, dehum, spectral-gate denoise, normalize | Apollo, AudioSR, … |
| Analyze | loudness, tempo, key, clipping, hum, echo | PaSST/CLAP taggers, … |

This is deliberate: the app is useful the instant it's installed, and the neural
models are quality upgrades slotted in through the same interface, never a
prerequisite.

## Desktop shell & frontend

### Frontend (`frontend/`, React + TypeScript)

A single-page app (`AppShell` + a module rail) that talks to the engine's local
HTTP API — `neiro.ui.server` — over `fetch`, never anything else. Ten modules
(Import, Analysis, Studio, Separate, Restore, Transcribe, Prefs, About, Learn,
Preferences, About) share one `SessionProvider` (`frontend/src/state/session.tsx`)
holding the current file, analysis report, and per-module job results, so
switching modules never re-fetches or loses state. Built with Vite; `npm --prefix
frontend run build` emits static assets that both the browser worksuite (served
directly by `neiro.ui.server`) and the desktop shell's webview load from the same
`src/neiro/ui/static/` directory (see `tauri.conf.json`'s `frontendDist`).

### Desktop shell (`src-tauri/`, Rust + Tauri 2)

A small native binary whose only job is process supervision and window
management — it contains no audio logic. On startup it spawns
`python -m neiro.cli ui --no-browser` as a child process, polls
`GET /api/health` until the engine responds, then loads
`http://127.0.0.1:8377/` into the main window. A background thread polls health
every 5 seconds and restarts the engine (with a capped retry count) if it exits or
stops responding, so a Python crash degrades to "restarting…" rather than a dead
window. The window's Content-Security-Policy pins `connect-src`/`img-src`/
`media-src` to that same local origin — the shell cannot be pointed elsewhere.
Two Tauri commands (`engine_status`, `restart_engine_cmd`) expose supervision
state to the frontend's About screen; no other IPC surface exists today, which
keeps the plugin/permission story (roadmap §10.1, [`docs/plugins.md`](plugins.md))
simple: the desktop shell itself is not a plugin host, the Python registry is.

## Testing philosophy

DSP is tested against **measurable ground truth** — reconstruction error below a
threshold, SNR improvement in dB, the exact pitches of a synthesized melody, a
byte-parsed MIDI file — rather than golden outputs. These assertions survive
refactors. See `tests/` and [`docs/adding-models.md`](adding-models.md) for how a
new model should be tested.
