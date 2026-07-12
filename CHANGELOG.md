# Changelog

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
