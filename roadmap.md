# Neiro — Roadmap

**Local source separation, restoration, and symbolic transcription.**

Neiro is a desktop application that takes any audio and returns its parts: isolated stems, restored signals, and precise symbolic notation (MIDI, MusicXML, tablature, engraved score). Everything runs locally. The architecture is a decoupled, graph-based processing engine in which every neural network is a replaceable node behind a uniform interface, so the application survives the churn of open-source model development without rewrites.

The name: *neiro* (音色) is Japanese for **timbre** — literally "the color of a sound." Telling timbres apart and drawing them out of a mix is the whole job of this software. Short, pronounceable, descriptive. No tagline.

---

## Table of Contents

1. [Product Principles](#1-product-principles)
2. [System Architecture](#2-system-architecture)
3. [Phase 1 — Core Foundations: Ingest, Graph Runtime, Memory Orchestration](#3-phase-1--core-foundations)
4. [Phase 2 — The Analysis Pass: Auto-Detection Intelligence](#4-phase-2--the-analysis-pass)
5. [Phase 3 — Separation Engine](#5-phase-3--separation-engine)
6. [Phase 4 — Enhancement & Restoration Engine](#6-phase-4--enhancement--restoration-engine)
7. [Phase 5 — Transcription Engine](#7-phase-5--transcription-engine)
8. [Phase 6 — Auto-Split Orchestration & Timeline Compiler](#8-phase-6--auto-split-orchestration--timeline-compiler)
9. [Phase 7 — Frontend](#9-phase-7--frontend)
10. [Phase 8 — Model Abstraction, Manifests & Plugin System](#10-phase-8--model-abstraction-manifests--plugin-system)
11. [Phase 9 — Performance Engineering](#11-phase-9--performance-engineering)
12. [Phase 10 — Quality, Evaluation & Testing](#12-phase-10--quality-evaluation--testing)
13. [Delivery Milestones](#13-delivery-milestones)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [References](#15-references)

---

## 1. Product Principles

These decide every tie-break in design and engineering.

1. **The result is the product.** Every architectural decision optimizes final audio/notation quality first, throughput second, features third. If an extra ensemble pass or a conditioning step measurably improves output, the pipeline should be able to take it — automatically in Simple mode, opt-in in Advanced mode.
2. **Local, private, inspectable.** No audio ever leaves the machine. No telemetry by default. Every output can be traced to the exact models, versions, and parameters that produced it (provenance is stored in the session file).
3. **Two doors, one engine.** Simple mode and Advanced mode drive the *same* pipeline. Simple mode is not a reduced engine — it is the engine with all decisions delegated to the analysis pass. Advanced mode exposes those decisions; it never requires them.
4. **Interoperability is invisible.** Separation, enhancement, and transcription are nodes in one graph, not three apps in one window. A stem can flow from separation → dereverb → transcription without the user managing intermediate files — but every intermediate artifact remains available and exportable.
5. **Honest software.** The UI reports what is happening in plain operational language. Confidence is displayed, not hidden. When a transcription is uncertain, the notes say so. When a model can't run on the user's hardware, the app says which one and why.
6. **Nothing is destructive.** All processing produces new artifacts. The source file is never modified. Every step can be A/B'd against its input, including a literal null test (phase-inverted sum) for separation results.
7. **Future-proof by abstraction.** The core never imports a model repository directly. Models arrive through manifests; the day BS-RoFormer is dethroned, its successor is a JSON file and a weights download, not a release.

---

## 2. System Architecture

### 2.1 Process model

```
┌─────────────────────────────────────────────────────────────┐
│  Shell (Tauri 2, Rust)                                       │
│  window management · file dialogs · OS integration · updater │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  UI (TypeScript + React, WebGL2 canvases)              │  │
│  │  waveform/spectrogram · piano roll · notation · mixer  │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────▲──────────────────────────────▲───────────────┘
                │ control (JSON-RPC/WebSocket)  │ bulk data (shared
                │                               │ memory / Arrow IPC)
┌───────────────┴───────────────────────────────┴───────────────┐
│  Engine (Python 3.11+, sidecar process)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐ │
│  │ DAG Runtime  │ │ VRAM Manager │ │ Model Registry          │ │
│  └──────────────┘ └──────────────┘ └────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐ │
│  │ Ingest       │ │ Analysis     │ │ Artifact Cache (CAS)    │ │
│  └──────────────┘ └──────────────┘ └────────────────────────┘ │
│  Node families: Separate · Enhance · Transcribe · Compile     │
│  Backends: PyTorch (CUDA/DirectML/CPU) · ONNX Runtime · ffmpeg│
└───────────────────────────────────────────────────────────────┘
```

- **Shell: Tauri 2.** Small binary, native menus and file dialogs, OS media integration, auto-update for the app itself (models update independently through the registry). Electron is the fallback if a required webview capability is missing on target platforms.
- **Engine: Python sidecar.** The entire deep-learning ecosystem this app depends on is Python-native; fighting that is wasted effort. The engine runs as a supervised child process, restartable without losing the UI. Crash isolation: an OOM in the engine never takes down the interface — the job is marked failed with the resumable checkpoint retained.
- **Transport.** Control messages (start job, progress, cancel, config) over local WebSocket with JSON-RPC. Bulk tensors (waveform previews, spectrogram tiles, piano-roll note streams) over shared memory / Arrow IPC so the UI never serializes megabytes through JSON.
- **Headless mode.** The same engine exposes a CLI (`neiro separate input.flac --preset reference`) and a watch-folder daemon for batch work. The GUI is a client, not the owner, of the pipeline.

### 2.2 Everything is a graph

A job is a directed acyclic graph of typed nodes exchanging typed artifacts:

- **Artifact types:** `AudioTensor` (memory-mapped float32/float16, any channel count, tagged with sample rate lane and provenance), `AnalysisReport` (JSON), `NoteStream` (interval events with float onset/offset, pitch, velocity, per-note confidence, channel/track tags), `TempoMap`, `Timeline` (multi-track compiled symbolic output), `Score` (engraving-ready structure).
- **Node families:** `Ingest`, `Analyze`, `Separate`, `Enhance`, `Transcribe`, `Compile`, `Export`. Every node declares its input/output artifact types, device requirements, and a VRAM profile.
- **Scheduler.** Topological execution with device-aware placement, priority lanes (interactive preview > batch), and per-node checkpointing. Long jobs survive app restarts: the graph plus completed-artifact hashes is the checkpoint.
- **Content-addressed artifact cache.** Every artifact is keyed by `hash(input hashes + node config + model version)`. Re-running a job with one changed parameter recomputes only the affected subgraph. Separating a song, then later transcribing it, reuses the cached stems byte-for-byte. Cache has a user-configurable size budget with LRU eviction and a "pin this session" override.

### 2.3 Where planning happens

A **Planner** sits between user intent and the graph. It takes (intent, AnalysisReport, hardware profile, quality tier) and emits a concrete DAG. Simple mode calls the planner with defaults; Advanced mode shows the planner's output as an inspectable pipeline the user can override node-by-node. This is the single mechanism behind "auto-detect," "auto-split," and "conditioning chains" — they are all planner policies, not special-cased code paths.

---

## 3. Phase 1 — Core Foundations

### 3.1 Dynamic data ingest

- **Decode anything.** ffmpeg is the universal front door: WAV/FLAC/AIFF/MP3/AAC/OGG/Opus/ALAC/WMA, video containers (extract audio track, let the user pick among multiple), CD-quality through 32-bit float / 384 kHz. Corrupt-file tolerance: salvage decodable regions, report gaps.
- **Sample-rate lanes.** Each ingest produces the source-rate master plus lazily materialized lanes: 44.1 kHz stereo for separation models, 16 kHz mono for sequence tokenizers and taggers, 24/48 kHz lanes for restoration models. Resampling via high-quality polyphase (soxr). Lanes are cache artifacts — created once, shared by every node that needs them.
- **Memory-mapped tensors.** Long files (live sets, 2-hour recordings) never fully load into RAM. All node processing is chunked over memory-mapped arrays with overlap-add reconstruction; chunk size is a per-model manifest hint, adjusted downward by the VRAM manager under pressure.
- **Loudness conditioning.** EBU R128 measurement at ingest. Models receive input normalized to their training loudness (a manifest field), and outputs are de-normalized back — a quiet bounce and a brickwalled master should separate identically.
- **Metadata retention.** Tags, artwork, chapter markers survive into exports.

### 3.2 DAG runtime

Covered in §2.2. Implementation notes:

- Nodes execute in worker threads/subprocesses; GPU nodes serialize through the device queue owned by the VRAM manager, CPU nodes (resampling, encoding, MIDI compilation) run genuinely parallel.
- Every node emits structured progress (`stage`, `fraction`, `eta`, `current chunk`) so the UI can show real stage names instead of a fake percentage.
- Cancellation is cooperative and prompt: chunk boundaries are cancellation points; a cancelled job retains its completed artifacts in cache.

### 3.3 VRAM context virtualization manager

The single owner of GPU memory. Nothing loads a model except through it.

- **Residency ledger.** Tracks every loaded model's weights footprint and measured peak activation footprint (recorded per chunk-size on first run, persisted per-device in the registry).
- **Admission control.** Before loading, it computes: weights + predicted activations + safety margin vs. free VRAM. If it doesn't fit: (1) evict least-recently-used idle models with explicit `del` + `torch.cuda.empty_cache()` + GC, (2) shrink chunk size within the model's declared valid range, (3) downgrade precision if the manifest allows fp16/bf16, (4) fall back to CPU with a clear warning, in that order. The result: no CUDA OOM faults reach the user, only slower fallbacks with stated reasons.
- **Warm pool.** Models stay resident between jobs with a TTL, so "separate, listen, tweak, re-run" doesn't reload 2 GB of weights each time. The pool is transparent in the UI (Preferences → Compute shows what's resident and lets the user flush it).
- **Sequencing policy.** Separation transformers and transcription decoders rarely coexist; the planner orders the graph so families execute in phases, and the manager force-flushes between phases when both won't fit — the roadmap's original "explicit dump before token decoders," generalized.
- **Multi-GPU.** Ensemble members shard across devices; single models pick the device with the most free memory. CPU-only machines get an honest experience: the fast lane models (HTDemucs, Basic Pitch) run acceptably on CPU, and the UI's time estimates reflect measured throughput, not hope.

---

## 4. Phase 2 — The Analysis Pass

Every ingested file gets one cheap, cached analysis pass. Its `AnalysisReport` is what makes Simple mode possible and Advanced mode smart. Target: under 15 seconds for a 4-minute song on a mid-range GPU.

### 4.1 Instrumentation detection

- **Tagger ensemble.** Windowed audio tagging with a pretrained transformer tagger (PaSST / BEATs class) plus CLAP zero-shot prompts for instruments outside the fixed vocabulary. Output: per-instrument activation curves over time, aggregated to `{instrument, confidence, active_regions}`.
- **Confidence gating.** Instruments above high confidence are asserted ("Detected: piano, drums, bass, electric guitar"); a middle band is listed as tentative ("possibly: organ"); below that, silence. Simple mode acts on asserted + tentative-confirmed-by-separation; Advanced mode shows the full curve.
- **Verification by separation.** For tentative instruments, the planner can schedule a cheap targeted separation probe; near-silent output demotes the detection. This closes the loop between the tagger's guess and ground truth.

### 4.2 Vocal condition detection

Vocals arrive in wildly different states; transcription and karaoke-grade separation both benefit from knowing which. Detected conditions, each with confidence:

- **Presence & type:** singing vs. rap vs. spoken; lead vs. ensemble; multi-singer overlap (routes to Medley Vox).
- **Reverb:** blind RT60 / direct-to-reverberant-ratio estimation via a small trained regressor on the vocal-dominant bands. Drives whether a dereverb node is inserted before vocal transcription and how strong.
- **Delay/echo:** autocorrelation of the vocal envelope reveals discrete repeats and their spacing; distinguishes tempo-synced delay from room reflections.
- **Doubles & harmonies:** disagreement between lead-isolation and all-vocal separation passes indicates doubled/harmony layers → karaoke pipeline (lead vs. backing) instead of a single vocal stem.
- **Processing artifacts:** hard pitch-correction detection (quantized f0 trajectories), distortion/saturation (harmonic-to-noise profile), telephone/lo-fi bandwidth, heavy compression (crest factor).
- **Degradations:** noise floor estimate, clipping (sample-histogram saturation), lossy-codec bandwidth ceiling (spectral rolloff signature → triggers Apollo restoration suggestion).

### 4.3 Musical priors

- **Tempo, beat, downbeat:** a current-generation beat tracker (Beat This! class) with madmom as fallback; produces the beat grid the timeline compiler quantizes against. Handles rubato by emitting a *tempo curve*, not a single BPM.
- **Key & chords:** global key plus a chord lattice from a chord-recognition transformer; used for spelling (F♯ vs G♭) in notation and as a prior for pitch decoders.
- **Structure:** section segmentation (intro/verse/chorus boundaries) — powers loop-a-section practice workflows and per-section processing.
- **Global degradation profile:** the whole-mix analogue of §4.2 — bandwidth, noise, clip, mono-ness, DC offset — feeding restoration suggestions.

### 4.4 The report as contract

`AnalysisReport` is a stable, versioned JSON schema. The planner consumes it; the UI renders it as the plain-language summary card; Advanced mode exposes every field as an overridable value. Users can correct it ("that's a Rhodes, not a piano") and the correction propagates to routing.

---

## 5. Phase 3 — Separation Engine

### 5.1 Model zoo (initial registry)

All models are registry entries (§10), not dependencies. Initial roster, chosen from current public leaderboard standings:

| Role | Models | Notes |
|---|---|---|
| Vocals / instrumental (flagship) | BS-RoFormer (viperx & SW variants), Mel-RoFormer (Kim), SCNet-XL / XL-IHF | The ensemble core; leaders on MVSep multisong leaderboard |
| 4–6 stem | BS-RoFormer SW (6-band), HTDemucs v4 (`htdemucs_ft`, `htdemucs_6s`), SCNet-XL, MDX23C / MDX23C-8KFFT | Draft lane uses HTDemucs; Reference lane ensembles |
| Karaoke / lead-back | Mel-RoFormer Karaoke, MDX-B Karaoke | Lead vs. backing/harmony split |
| Multi-singer | Medley Vox | Overlapping vocalists |
| Drum kit decomposition | drumsep-class MDX23C, LarsNet | Kick/snare/toms/hats/cymbals (+7-way cascade) |
| Fine percussion | MVSep Percussion-class model | Bells, congas, marimba, tambourine, chimes |
| Guitar family | Electric / acoustic guitar / bass isolation nodes; BS-family fine-tunes | |
| Keys family | Piano / keys / organ / harpsichord / accordion nodes | |
| Synth & ambience | Synth pad/lead isolation | |
| Strings / winds / brass | Dedicated fine-tunes where available; SW multi-band otherwise | |
| Legacy / texture | UVR VR-arch convnets, VitLarge23, Demucs3 MMI | Diversity members for ensembles; some artifacts differ usefully |
| Utility | Denoise, dereverb, crowd removal, de-breath, phantom-center extraction | Shared with the enhancement engine |

The registry ships with *validated leaderboard priors*: default ensemble weights and expected per-stem SDR, sourced from public benchmarks (MVSep multisong, SDX challenge results) and refreshed with registry updates.

### 5.2 Dual-tier paths, generalized to three quality tiers

- **Draft** — one fast model (HTDemucs ft or a small Mel-RoFormer), 25% chunk overlap, no TTA. Seconds-per-song on GPU; the "I just want to hear the vocal" lane and the default for previews.
- **Standard** — the single best current model for the requested stems, 50% overlap, polarity-pair TTA. The default in Simple mode.
- **Reference** — full weighted ensemble + TTA + bleed suppression + residual accounting (below). Minutes-per-song; the "this is going on a record / into a transcription" lane. Simple mode escalates to Reference automatically when the job feeds transcription of a dense mix.

Every tier displays a measured time estimate for *this machine* (calibrated on first run, updated continuously).

### 5.3 Ensemble engine

- **Fusion domain.** Ensembling happens on complex spectrograms: weighted magnitude averaging with phase taken from the highest-prior member (or per-bin phase voting), plus selectable `mean / median / max-mag / min-mag` modes — max-mag favors recall for the target stem, min-mag favors purity of the complement. Defaults follow leaderboard-validated weights; Advanced mode exposes the weight vector.
- **Test-time augmentation.** Polarity inversion, channel swap, small time offsets; outputs are de-augmented and averaged. Cheap, consistent SDR gains.
- **Chunking.** Overlap-add with Hann-windowed crossfades; chunk length and overlap are per-model manifest hints. Long-context models get long chunks when VRAM allows — the manager negotiates.
- **Bleed suppression.** Post-pass that estimates residual leakage of rival stems (short-window adaptive gain on the rival's spectral fingerprint) and subtracts it. Always A/B-able; never applied silently in Draft.
- **Stereo integrity.** Models that collapse width get a mid/side-aware wrapper: separate M and S where beneficial, or restore width from the source's side channel scaled by the stem's mask.

### 5.4 Mathematical residual extraction

Unchanged in principle from the source roadmap, formalized as a first-class node: `Residual = Source − Σ(extracted stems)`, computed in the time domain at source sample rate with per-stem latency compensation. This yields the "everything else" track — rare synths, foley, room — with zero model artifacts. The residual is also a *diagnostic*: its loudness curve is the separation quality report (a loud residual where the mix was fully accounted for means a model dropped something). The UI's null-test button plays exactly this artifact.

### 5.5 Cascades and presets

Planner-emitted graph presets:

- **Vocals + Instrumental** — flagship ensemble; auto-upgrades to karaoke split when doubles/harmonies were detected.
- **4-stem / 6-stem** — vocals, drums, bass, other (+ guitar, piano); Reference tier ensembles per stem, with the *other* stem produced by residual, not by a model.
- **Drums deep-dive** — stems pass then drum-kit decomposition into up to 7 kit pieces.
- **Detect-all** — the auto mode: separates every instrument asserted by the analysis pass via cascaded targeted models (extract → subtract → extract next from remainder, ordered by detection confidence and spectral dominance), residual last. The cascade order matters and is planner-optimized: strong broadband sources (drums, bass) come out first so delicate extractions (strings, bells) work on cleaner remainders.
- **Cinematic** — dialog / music / effects for video-derived audio.

### 5.6 Outputs

Stems export as WAV (16/24/32f) or FLAC with correct loudness restoration, latency-aligned to the sample against the source, named by a configurable template (`{song} - {stem}.flac`), with an optional DAWproject/folder-per-song layout for direct DAW import. Recombined-stem mastering via Matchering (reference-based) is available as a final optional node.

---

## 6. Phase 4 — Enhancement & Restoration Engine

Restoration is the third node family, equal citizen to separation and transcription — usable standalone ("fix this old recording") and as *conditioning chains* that other pipelines insert automatically.

### 6.1 Restoration roster

| Task | Models / methods |
|---|---|
| Lossy-codec restoration (MP3 32–128 kbps → lossless character) | Apollo (band-sequence modeling) |
| Bandwidth extension / super-resolution (→ 48 kHz) | AudioSR-class diffusion; latent-bridge SR models as they stabilize |
| All-in-one music restoration & mastering | SonicMaster-class controllable model |
| Denoise (broadband, hiss) | DeepFilterNet3 (fast lane), MSST denoise models (quality lane) |
| Dereverb | MDX/RoFormer dereverb fine-tunes, strength guided by measured RT60 |
| De-clip | Iterative declipping (A2SB-class generative for severe cases; classical convex for mild) |
| De-click / de-crackle (vinyl, damaged media) | Dedicated declick models + median-filter fallback |
| Hum / interference | Adaptive notch with harmonic tracking (50/60 Hz families) |
| Vocal restoration | VoiceFixer / Resemble-Enhance class for damaged vocal stems |
| De-breath / de-ess | aufr33-class models |
| Mastering to reference | Matchering |

### 6.2 Conditioning chains — the interoperability mechanism

A conditioning chain is a planner-inserted sequence of enhancement nodes applied to a specific artifact *because of detected conditions*, in service of a downstream consumer:

- Vocal stem carries reverb (RT60 0.9 s) and is headed to melody transcription → insert dereverb (strength from measurement) → transcribe. The *user's exported stem* remains the un-dereverbed one unless they chose otherwise; the enhanced intermediate is clearly labeled.
- Source file shows a 16 kHz codec ceiling → suggest Apollo before separation (restoration first measurably improves separation of lossy sources); in Simple mode this is applied automatically above a confidence threshold and reported: "Input was low-bitrate; restored before separating."
- Drum stem is clipped → declip before diffusion drum transcription.

Rules that keep this cohesive rather than magical:

1. Chains are **visible** — the results screen lists every node that ran, and each intermediate is auditioned/exported with one click.
2. Chains are **overridable** — Advanced mode edits them per-stem (add/remove/reorder nodes, set strengths); Simple mode has a single "process inputs before transcription: auto / off" switch for users who want raw behavior.
3. Chains are **never circular** — the planner enforces family ordering (restore → separate → per-stem enhance → transcribe → compile).
4. Enhanced artifacts are **cache citizens** — a dereverbed vocal computed for transcription is reused if the user later exports it.

---

## 7. Phase 5 — Transcription Engine

### 7.1 Decoder routing

A router maps each (instrument, conditions) pair to the best decoder. Initial table:

| Instrument | Primary decoder | Fallback / complement |
|---|---|---|
| Piano (incl. sustain pedal, velocity, micro-timing) | Transkun v2 (semi-Markov CRF) | hFT-class transformer |
| Guitar → tablature | TimbreAMT (string/fret aware) | YourMT3+ stem decode → DP fret assignment |
| Bass | Fine-tuned Basic Pitch / MT3-family | Contour tracker for fretless |
| Drums & percussion | Noise-to-Notes (diffusion, velocity-aware) | ADT convnet fallback (CPU lane) |
| Vocals — melody | SVT_SpeechBrain cross-attention | Basic Pitch on cleaned vocal stem |
| Vocals — lyrics | Whisper-class ASR + forced alignment (CTC / MFA) onto the melody timeline | |
| Strings, winds, brass | MIROS / YourMT3+ conditioned per-stem | Basic Pitch (instrument-agnostic) |
| Synths, mallets, other | Basic Pitch (with pitch-bend capture) | MIROS full-mix tokens |
| Chords (analysis layer) | Chord transformer over the full mix | |
| Full-mix multi-instrument (no split) | MIROS (MusicFM-backbone seq2seq) / YourMT3+ | The one-shot lane |

Every decoder's output normalizes into the same `NoteStream` interval representation: float-second onsets/offsets, MIDI pitch + pitch-bend curves, velocity (internally 16-bit for headroom), per-note confidence, articulation tags where the model provides them (pedal, hammer-on, ghost note).

### 7.2 When transcription invokes separation (and enhancement)

Policy, not hardcoding — the planner decides per instrument:

- If the user asked for one instrument and the analysis shows it is *exposed* (solo piano recording), decode directly. Separation would only add artifacts.
- If the mix is dense or the full-mix decoder's confidence on a dry run of the first 30 seconds is low, run the auto-split path (§8): separate the target's stem (Reference tier), condition it (§6.2), then decode with the specialized model.
- Hybrid voting: for critical jobs, decode *both* the full mix (multi-instrument model, which hears context) and the isolated stem (specialist, which hears detail), then merge — stem decoder wins on onsets/pitch, full-mix decoder arbitrates octave errors and fills masked passages. This is the Reference tier of transcription.

### 7.3 Post-processing: from events to music

- **Tempo mapping.** The analysis beat grid becomes a tempo map; note events get positions in musical time. Rubato is preserved as a tempo *curve* rather than forcing notes off-grid.
- **Groove-preserving quantization.** Two-layer representation: the quantized grid position (for notation) plus the micro-timing offset (for playback realism). Quantization strength, grid resolution, swing detection, and tuplet inference are settings; the offsets layer makes quantization *reversible*.
- **Voice & hand separation.** Polyphonic streams split into notation voices; piano gets skyline + HMM hand assignment; drums map to standard percussion notation.
- **Tab assignment.** Dynamic programming over playability cost (fret span, position shifts, open-string preference) turns guitar/bass note streams into tablature; tuning is a setting with automatic detection attempt.
- **Dynamics reconciliation.** Compiled velocities are compared against the source stem's loudness envelope and rescaled (Score-HPT-style correction) so the MIDI performance *sounds* like the record, and notation dynamics (p/mf/f, hairpins) are derived from the corrected curve.
- **Spelling & notation intelligence.** Key/chord context drives enharmonic spelling; meter from downbeat detection; automatic clef choice, ottava lines for extremes, simplification pass for readability (a "played" layer and a "readable" layer, togglable).
- **Confidence surfaces through.** Per-note confidence is carried into the piano roll (subtle desaturation of uncertain notes) and notation (small marker), and summarized per track ("piano: high confidence; strings: medium — dense passage at 2:14").

### 7.4 Export formats

MIDI 1.0 (multi-track, tempo map, key/meter events), MPE / MIDI 2.0-ready export for pitch-bend-rich material, MusicXML and MEI (via partitura/music21-class conversion), Guitar Pro, PDF via Verovio or MuseScore CLI engraving, ASCII tab, LRC (lyrics synced), and the native session format with everything.

---

## 8. Phase 6 — Auto-Split Orchestration & Timeline Compiler

### 8.1 Conditional routing

When auto-split is active (default in Simple mode for multi-instrument material), the planner:

1. Takes the instrument list (detected or user-selected).
2. Emits the separation cascade (§5.5 detect-all, restricted to requested instruments) at the tier the job warrants.
3. Attaches per-stem conditioning chains from detected conditions.
4. Routes each conditioned stem to its specialist decoder — mono-instrument models never see cross-frequency masking from rivals, which is the entire point.
5. Optionally runs the full-mix decoder in parallel for hybrid voting (§7.2).

### 8.2 Temporal timeline compiler

The aggregation layer that makes N parallel decoders produce *one piece of music*:

- **Master clock.** All artifacts carry sample-accurate provenance offsets; every model's algorithmic latency is measured once (impulse/click calibration per model version, stored in the registry) and compensated. Streams merge on the absolute clock before any musical-time mapping.
- **Cross-stream reconciliation.** Duplicate detections across stems (a piano note bleeding into the "other" stem's transcription) are deduplicated by onset/pitch proximity with stem-confidence priority. Downbeat consensus across streams corrects individual decoders' bar-phase errors.
- **Track assembly.** Instrument families → tracks with General MIDI program mapping (user-overridable), drums → channel 10 mapping, lyrics → synced meta events.
- **Single output.** One `Timeline` artifact feeds every view (piano roll, notation, mixer) and every export — there is no format-specific re-transcription.

---

## 9. Phase 7 — Frontend

### 9.1 Design language

**Dark-first, ink-on-slate, one accent.** The interface should feel like a well-made instrument: quiet until played, precise when used.

- **Surfaces.** Near-black slate background layers (3 elevations, separated by luminance not borders), high-contrast text, one restrained accent hue used only for interactive/active states. Full light theme and high-contrast theme are first-class, not afterthoughts.
- **Stem & track colors.** A fixed colorblind-safe categorical palette (Okabe–Ito derived) assigned consistently: vocals, drums, bass, guitar, keys, strings, winds, other always get the *same* colors across mixer, piano roll, and notation. Color never carries meaning alone — every colored element has a text label or icon.
- **Type.** A single grotesque family (Inter or IBM Plex Sans) plus its mono for timecodes and values; tabular numerals everywhere numbers align. Sizes on a modest scale; a UI density setting (comfortable/compact) and independent font scaling.
- **Motion.** 150–200 ms ease-out transitions, only where they explain causality (panel opens from its trigger). `prefers-reduced-motion` honored globally. Nothing pulses, nothing bounces, no confetti.
- **Rendering.** Waveforms, spectrograms, and the piano roll are WebGL2 canvases with level-of-detail tiles streamed from the engine — 60 fps pan/zoom on hour-long files.

**Language rules (enforced in review, documented for contributors):**

| Say | Not |
|---|---|
| Separate | Unmix with AI ✨ / Magic Split |
| Working — vocals, chunk 14 of 52 | Brewing magic… / Almost there! |
| Detected: piano, drums, bass. Vocals have reverb (moderate). | Our AI found some awesome stems! |
| Couldn't load SCNet-XL: needs 9.4 GB VRAM, 7.9 GB free. Using BS-RoFormer instead. | Oops! Something went wrong 😅 |
| Transcription confidence is low for strings between 2:14–2:41. | (silently ship bad output) |

No exclamation points in system text. No first-person app voice. Errors state what failed, why, and the action taken or available. Buttons are verbs describing the operation.

### 9.2 Simple mode

One screen. A drop zone (and an equivalent Open button — drag-and-drop is never the *only* way).

1. **Drop file → analysis card.** Plain summary: "4:03 · 44.1 kHz FLAC · Detected: drums, bass, electric guitar, piano, vocals (lead + harmonies, moderate reverb) · 128 BPM, F minor · Input quality: good." Tentative detections shown with a "confirm?" affordance.
2. **Two primary actions.** **Separate** (preset dropdown: Vocals + instrumental / 4 stems / 6 stems / All detected / Drums deep-dive) and **Transcribe** (dropdown: All detected / Choose instruments… — the chooser is a checklist seeded from detection). A third quiet action: **Restore** (auto: fixes what the analysis flagged). One Start button.
3. **Progress.** Named stages with honest per-stage progress and a cancel that works. A "details" disclosure shows the actual pipeline running — Simple mode hides complexity, not information.
4. **Results.** Separation → the stem mixer (§9.5). Transcription → piano roll / notation (§9.4). Every result screen has Export and "Open in Advanced" (carries the exact pipeline over for tweaking and re-run — the incremental cache makes this cheap).

Auto-behavior in Simple mode: quality tier Standard (escalates to Reference when feeding transcription), auto-split on, conditioning chains on with reporting, detect-all thresholds conservative.

### 9.3 Advanced mode

The same screens with the planner's decisions exposed:

- **Pipeline view.** A read-only left-to-right graph of what will run — every node clickable to a config panel. Users don't wire graphs by hand (that's a plugin-developer activity); they *edit the plan*: swap a model, change ensemble weights, insert/remove a conditioning node, change tiers per stem.
- **Separation config.** Per-stem model selection with the registry's quality/speed/VRAM columns, ensemble member list with weight sliders and fusion mode, overlap/chunk/TTA controls, bleed suppression toggle, residual handling.
- **Transcription config.** Per-instrument decoder choice, hybrid voting on/off, quantization panel (grid, strength, swing, tuplets), tempo-map lock (use detected / tap manually / fixed BPM), spelling and notation options, tab tuning.
- **Condition editor.** The detected-conditions list per stem with override toggles and strength controls for each enhancement node.
- **Everything has a "reset to planned" affordance** — the planner's choice is always visible as the default, so Advanced mode teaches rather than abandons.

### 9.4 Piano roll & sheet music

Shared transport across both views (they are two projections of the same `Timeline`), synchronized cursor, per-track show/hide.

**Piano roll:**

- **Play mode.** Continuous playback with speed 25–200% — the *source audio* time-stretched (engine-rendered, pitch-preserving) in sync with MIDI, so users hear the record slow down, not a synthesized approximation; per-track audio/MIDI blend control (hear the real piano stem, the transcribed MIDI, or both). Loop regions snap to detected sections; count-in; metronome from the tempo map.
- **Learn mode.** Playback halts at each note/chord group and waits: for the correct input from a connected MIDI keyboard (WebMIDI), or for a step-advance key when no hardware is present. Configurable hands/tracks to wait on (wait left, play right automatically), upcoming-note highlighting, wrong-note feedback that is informative rather than punitive, section looping with gradual speed ramp (start 60%, +5% per clean pass — optional).
- **Editing.** The transcription is a draft the user can correct: move/resize/delete notes, velocity lane, pitch-bend lane, pedal lane, multi-select, full undo history. Edits mark notes as user-verified (confidence 100%) and feed exports.
- **Display.** Vertical keyboard with played-key highlighting, per-track colors from the fixed palette, confidence desaturation (toggle), measure grid from the tempo map, zoom from full-song overview to single-beat detail.

**Sheet music:**

- Engraved rendering (Verovio-class in-app), cursor playback, the same continuous/learn modes, transposition and part extraction, concert/written pitch, "readable vs. played" layer toggle (§7.3), print/PDF export matching the on-screen engraving.

### 9.5 Stem mixer (separation results)

Per-stem channel strips: fader, mute/solo, pan, waveform/spectrogram toggle; residual track always present and labeled; **A/B** (instant original-vs-recombined switch) and **null test** (audition `original − Σ stems`) buttons; per-stem "re-run with different model" shortcut into Advanced; export selection with format panel.

### 9.6 Download manager & preferences

**Models (Preferences → Models):**

- Registry table: name, task, quality/speed class, size on disk, license badge, installed/available, last used. Resumable downloads with SHA-256 verification; storage location configurable (with an explicit warning when the chosen path is inside a cloud-synced folder like OneDrive — sync churn on multi-GB weights is a real problem); storage budget with least-recently-used suggestions.
- Packs: **Starter** (~2 GB: one good separator, Basic Pitch, piano decoder), **Separation Complete**, **Transcription Complete**, **Everything**. Default behavior: download-on-first-use with a size prompt.
- License gating: models with non-commercial or research licenses are labeled, and the label follows their output into export metadata; nothing is silently mislabeled as unrestricted.

**Preferences:**

- **Compute** — GPU selection, VRAM ceiling override, CPU thread cap, precision policy, warm-pool size/TTL, resident-models view with flush.
- **Storage** — cache location & budget, download location, export defaults & naming templates.
- **Audio** — output device, sample rate, monitoring latency.
- **Formats** — WAV bit depth, FLAC level, MIDI PPQ, MusicXML flavor, engraving defaults.
- **Interface** — theme (dark/light/high-contrast), density, font scale, accent, palette variant, reduced motion, language.
- **Shortcuts** — fully rebindable keyboard map with conflict detection.
- **Privacy** — one screen stating: no network access except model downloads and app updates, both user-initiated; no telemetry. A toggle to allow anonymous crash reports, off by default.

### 9.7 Accessibility

Treated as a release gate, not a feature:

- Complete keyboard operability — every flow including learn mode, mixer, and note editing works without a pointer; visible focus everywhere; logical tab order; shortcuts follow platform conventions and are rebindable.
- Screen-reader support: the analysis card, progress stages, results summaries, and confidence reports are real text with ARIA live-region updates; the piano roll and notation views expose a structured note list alternative ("Measure 12, beat 3: C5 quarter note, right hand").
- No color-only meaning; palette validated for the three common dichromacies; contrast meets WCAG AA in all three themes; UI scales to 200% without loss.
- Reduced-motion and no-flash guarantees; audio comparisons have visual meters (never sound-only feedback); learn mode's wrong-note feedback has visual + optional haptic (MIDI keyboards with feedback) forms.
- All documentation in-app, searchable, and plain-language.

---

## 10. Phase 8 — Model Abstraction, Manifests & Plugin System

### 10.1 Unified model interface

Every network — vendored, community, or user-supplied — is wrapped in one of four rigid interfaces matching the node families:

```python
class Separator(Protocol):
    def profile(self) -> ModelProfile          # VRAM curve, chunk hints, latency, lanes
    def load(self, device, precision) -> None
    def separate(self, chunk: AudioTensor) -> dict[str, AudioTensor]
    def unload(self) -> None

# Enhancer, Transcriber, Analyzer follow the same shape;
# Transcriber returns NoteStream instead of audio.
```

The engine never sees a repository's internals; adapters live in isolated per-model packages with pinned dependencies (uv-managed environments per adapter family where dependency sets conflict).

### 10.2 Manifest schema

Models register by dropping a folder into `models/` containing weights and a manifest:

```json
{
  "manifest_version": 2,
  "id": "bs-roformer-viperx-1297",
  "task": "separate",
  "stems": ["vocals", "instrumental"],
  "display_name": "BS-RoFormer (viperx 1297)",
  "adapter": "adapters.roformer:BSRoformerAdapter",
  "framework": "torch>=2.3",
  "weights": [
    { "url": "https://…/model.ckpt", "sha256": "…", "size_bytes": 639201280 }
  ],
  "audio": { "sample_rate": 44100, "channels": 2, "train_loudness_lufs": -14.0 },
  "chunking": { "seconds": 8.0, "overlap": 0.5, "min_seconds": 2.0 },
  "vram": { "fp32_gb": 8.9, "fp16_gb": 4.7, "supports_fp16": true },
  "ensemble_hints": { "leaderboard_sdr": { "vocals": 11.31 }, "default_weight": 1.0 },
  "license": { "spdx": "NonCommercial", "source": "https://…" },
  "provenance": { "author": "viperx", "trained_on": ["musdb18hq", "private"] }
}
```

- **Dynamic registration.** The registry scans on startup and on demand; a valid manifest appears in the UI immediately — no core changes to add a model, swap weights, or define a new ensemble (ensembles themselves are manifests referencing member IDs and weights).
- **Signed index.** The curated registry ships as a signed JSON index the app can refresh, delivering new SOTA models and updated ensemble priors between app releases.
- **Custom nodes.** Power users can register pre/post-processing nodes as restricted Python entry points (audio-in/audio-out or NoteStream transforms) with an explicit, per-plugin permission grant — plugins are code, and the UI says so plainly before enabling one.
- **Version pinning.** Sessions record model IDs + weight hashes; reopening an old session with changed models offers "reproduce exactly (download pinned weights)" vs. "re-run with current models."

---

## 11. Phase 9 — Performance Engineering

- **Precision & compilation.** fp16/bf16 autocast wherever manifests allow; `torch.compile` for steady-state chunk loops; ONNX Runtime export lanes for the models that convert cleanly (Basic Pitch, VR-arch convnets, taggers), with TensorRT/DirectML execution providers probed at install.
- **Device ladder.** CUDA → DirectML (covers non-NVIDIA Windows GPUs) → CPU, per node, chosen by the VRAM manager; the ladder is visible in Preferences → Compute with measured throughput per rung.
- **Pipelining.** Decode/resample of chunk *n+1* overlaps GPU inference of chunk *n*; encoding of finished stems overlaps remaining separation; ensemble members for the same chunk batch together when a single device fits them.
- **I/O discipline.** Weights load via memory-mapped safetensors (converted at install where sources ship pickles — also a safety win); intermediate stems optionally store as float16 to halve cache footprint; spectrogram tiles for the UI render progressively.
- **Cold-start budget.** App interactive < 2 s; first analysis result < 15 s for a typical song on mid-range GPU; Draft separation ≈ faster-than-realtime on GPU. These are tracked in CI on reference hardware, and regressions block release.
- **Crash resume.** Jobs checkpoint at chunk granularity; an engine crash or power loss resumes from the last completed chunk, not from zero.

---

## 12. Phase 10 — Quality, Evaluation & Testing

- **Separation harness.** MUSDB18-HQ and MoisesDB evaluation subsets; SDR/SI-SDR per stem plus a bleed metric (rival-stem energy in target) and the residual-loudness diagnostic; every registry model and every default ensemble has recorded scores, and those scores are what the UI's quality classes are derived from — the displayed "quality: high" is a measurement, not marketing.
- **Transcription harness.** mir_eval note-level F1 (onset, onset+offset, +velocity) on MAESTRO (piano), Slakh2100 (multi-instrument), GuitarSet (guitar/tab), ENST/ADTOF (drums), with the auto-split pipeline benchmarked *end-to-end* against the same ground truth — the number that matters is the full pipeline's, not any single model's.
- **Golden files.** A fixed corpus of ~30 varied recordings (dense mixes, solo instruments, degraded sources, live recordings, odd meters, rubato piano) with frozen expected outputs; any model or pipeline change diffs against them, and intentional improvements update the goldens with review.
- **Perceptual checks.** ViSQOL/PEAQ-class metrics on enhancement outputs; periodic human listening protocol for ensemble weight changes.
- **Robustness suite.** Corrupt files, 7-hour files, mono files, 8 kHz sources, silence, DC offset, clipped-to-square material, files with unicode/emoji names, files inside OneDrive; OOM soak tests that verify the VRAM manager's downgrade ladder engages instead of crashing.
- **Determinism.** Fixed seeds for stochastic decoders (diffusion transcription) by default so re-runs reproduce; a "resample" action exists where stochasticity is useful.

---

## 13. Delivery Milestones

| Milestone | Scope | Exit criterion |
|---|---|---|
| **M0 — Spine** | Tauri shell + Python engine + transport; ingest with lanes; DAG runtime with cache; VRAM manager v1; one separator (HTDemucs) end-to-end via CLI and a minimal window | Drop a file, get 4 stems, cancel/resume works, no OOM on 8 GB GPU |
| **M1 — Separation MVP** | Simple mode UI; BS-RoFormer + Mel-RoFormer in registry; Standard tier; stem mixer with A/B + null test; export; download manager v1 | A stranger separates a song to FLAC stems without documentation |
| **M2 — Intelligence** | Full analysis pass (instrumentation, vocal conditions, tempo/key/structure); Reference-tier ensembles + TTA + residual; detect-all cascade; karaoke & drumsep presets | Detection precision/recall targets met on the golden corpus; ensemble beats best single model on the harness |
| **M3 — Transcription MVP** | Basic Pitch + Transkun + drum decoder; router v1; timeline compiler v1; piano roll with play mode + editing; MIDI export | Solo piano and a pop 4-stem transcribe to usable MIDI; end-to-end F1 recorded |
| **M4 — Full symbolic** | Auto-split orchestration with hybrid voting; YourMT3+/MIROS; lyrics; quantization/notation intelligence; sheet music view; learn mode; MusicXML/PDF/tab export | The full-band demo song renders a readable multi-part score |
| **M5 — Restoration** | Apollo, AudioSR-class SR, denoise/dereverb/declip/declick; conditioning chains wired into planner; Restore action in Simple mode | Degraded-input corpus shows measured separation & transcription gains with chains on |
| **M6 — Openness** | Advanced mode complete (pipeline view, condition editor); manifest v2 + signed index + custom node plugins; session format with provenance & pinning; headless CLI + watch folders | A third party adds a new separator via manifest alone |
| **M7 — 1.0** | Performance budget enforcement; accessibility audit passed (keyboard, screen reader, contrast); crash-resume hardening; docs; light/high-contrast themes final | Release gates: perf CI green, a11y audit clean, golden corpus stable |

Each milestone ships as a usable build; nothing waits for 1.0 to be touchable.

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Model licensing.** Much of the SOTA (community RoFormer fine-tunes, MVSep-adjacent weights) is non-commercial or unclearly licensed. | License is a first-class manifest field, surfaced in UI and export metadata; curated registry only indexes weights with verified terms; app distribution decisions (free/commercial) account for the gated set; permissively licensed defaults (Demucs, Basic Pitch, Apollo) always available. |
| **Upstream churn.** Model repos break, move, or bit-rot. | Adapters pin dependencies per-family; weights re-hosted (where licenses permit) with hash verification; the manifest layer means breakage is contained to one adapter. |
| **VRAM diversity.** Users span 4 GB laptops to 24 GB workstations. | Admission control + downgrade ladder (§3.3); quality tiers with honest per-machine time estimates; every flagship task has a CPU-viable fallback. |
| **Transcription ceiling.** Dense mixes will produce imperfect scores no matter the pipeline. | Confidence surfaced per note/track; editing tools treat output as a draft; hybrid voting and auto-split push the ceiling; UI language never overclaims. |
| **Windows GPU heterogeneity.** Non-NVIDIA users. | DirectML lane probed and benchmarked at install; ONNX conversions prioritized for the default models. |
| **Cloud-synced folders.** Project lives under OneDrive; multi-GB caches and model weights will thrash sync. | Default cache/model paths in `%LOCALAPPDATA%`; explicit warning when a user points storage at a synced path. |
| **Scope gravity.** This roadmap is large. | Milestone discipline: M1 is a complete, shippable separation tool; every later phase adds a node family to a working product rather than assembling everything at the end. |

---

## 15. References

### Separation — architectures & ensembles
- BS-RoFormer: [Music Source Separation with Band-Split RoPE Transformer](https://arxiv.org/pdf/2309.02612) · [Jensen configurations](https://github.com/KimberleyJensen/)
- Mel-RoFormer: [Mel-Band RoFormer for Music Source Separation](https://arxiv.org/pdf/2310.01809)
- SCNet / SCNet-XL / XL-IHF: [SCNet repository](https://github.com/yoyololicon/SCNet)
- MDX23C: [MVSEP-MDX23 model](https://github.com/ZFTurbo/MVSEP-MDX23-music-separation-model)
- HTDemucs v4 / Demucs3 MMI: [facebookresearch/demucs](https://github.com/facebookresearch/demucs)
- UVR VR architecture: [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui)
- Training & pretrained-model hub: [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) · [pretrained models list](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md) · [ensemble docs](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/ensemble.md)
- Ensembling analysis: [An Ensemble Approach to Music Source Separation](https://arxiv.org/html/2410.20773v1)
- MVSep algorithm & leaderboard index: [mvsep.com/en/algorithms](https://mvsep.com/en/algorithms) · Ensemble All-In: [algorithms/6](https://mvsep.com/algorithms/6) · Medley Vox: [algorithms/60](https://mvsep.com/algorithms/60) · Percussion: [algorithms/95](https://mvsep.com/algorithms/95) · Synth: [algorithms/85](https://mvsep.com/algorithms/85)
- Benchmarks & landscape: [2026 separation benchmark](https://aistemsplitter.org/blog/htdemucs-vs-bs-roformer-vs-spleeter-2026-benchmark) · [drum stem guide](https://neuralanalog.com/stems/how-to-separate-individual-drum-stems) · [vocal model comparison](https://neuralanalog.com/stems/best-ai-stem-separation-model-vocals) · [BS-RoFormer overview](https://grokipedia.com/page/BS-RoFormer)

### Transcription
- YourMT3+: [paper](https://arxiv.org/pdf/2407.04822) · [repository](https://github.com/mimbres/yourmt3)
- MIROS & 2025 AMT Challenge: [results paper](https://arxiv.org/html/2603.27528v1) · [challenge site](https://ai4musicians.org/transcription/2025transcription.html)
- Transkun v2: [repository](https://github.com/yujia-yan/transkun)
- Basic Pitch: [spotify/basic-pitch](https://github.com/spotify/basic-pitch)
- TimbreAMT: [repository](https://github.com/madderscientist/timbreAMT)
- Noise-to-Notes: [arXiv 2509.21739](https://arxiv.org/abs/2509.21739)
- Rubato engine: [arXiv 2605.24291](https://arxiv.org/abs/2605.24291)
- Score-HPT: [arXiv 2508.07757](https://arxiv.org/abs/2508.07757)
- SVT_SpeechBrain: [repository](https://github.com/guxm2021/SVT_SpeechBrain)
- MuScriptor: [repository](https://github.com/muscriptor/muscriptor)
- Drum transcription data realism: [arXiv 2601.09520](https://arxiv.org/pdf/2601.09520)

### Enhancement & restoration
- Apollo: [paper](https://arxiv.org/abs/2409.08514) · [JusperLee/Apollo](https://github.com/jusperlee/apollo)
- AudioSR: [versatile_audio_super_resolution](https://github.com/haoheliu/versatile_audio_super_resolution)
- SonicMaster (all-in-one restoration/mastering): [arXiv 2508.03448](https://arxiv.org/pdf/2508.03448)
- A2SB (audio-to-audio Schrödinger bridges): [arXiv 2501.11311](https://arxiv.org/pdf/2501.11311)
- AnyEnhance: [arXiv 2501.15417](https://arxiv.org/pdf/2501.15417)
- Super-resolution survey: [arXiv 2605.16681](https://arxiv.org/pdf/2605.16681)
- Matchering: [sergree/matchering](https://github.com/sergree/matchering)

### Infrastructure
- FFmpeg: [ffmpeg.org](https://ffmpeg.org)
- Mido: [mido/mido](https://github.com/mido/mido)

---

*This document is the single source of truth for scope. Changes to it are changes to the product.*
