# Performance

Neiro's model-free lanes are engineered to run comfortably faster than real time
on a CPU, so the app is responsive before any GPU model is installed. This page
explains how performance is achieved and how to measure it on your machine.

## Measure it yourself

```bash
python scripts/benchmark.py --seconds 30
```

The script reports **real-time factor (RTF)** — audio seconds processed per second
of wall clock — for each DSP stage. RTF > 1 means faster than real time. It needs
no downloads or GPU, so results are reproducible.

### Reference numbers

Indicative RTF on a mid-range desktop CPU (single core, 20 s stereo @ 44.1 kHz).
Your numbers will differ; run the benchmark for your hardware.

| Stage | RTF (higher is faster) |
|-------|------------------------|
| Analysis (full report) | ~140× |
| Centre extraction (vocals/instrumental) | ~90× |
| Spectral-gate denoise | ~70× |
| Centre ensemble + TTA (3 views) | ~28× |
| HPSS | ~8× |
| YIN transcription (mono) | ~6× |
| Waveform peaks | ~2900× |
| Spectrogram image | ~700× |

Every stage is real-time-capable; the heavier ones (HPSS, YIN) still process a
song in a fraction of its duration.

## How the speed is achieved

- **Vectorised DSP.** STFT framing uses stride tricks and batched FFTs; YIN's
  difference function is computed over all candidate lags at once. No Python
  inner loops over samples.
- **Chunked, memory-mapped processing.** Long files are processed in
  overlap-added chunks rather than loaded whole, bounding memory on 2-hour inputs.
- **Content-addressed cache.** Re-running a job after changing one parameter
  recomputes only the affected subgraph; unchanged nodes return cached artifacts
  instantly (verified in the test suite). Separating then transcribing the same
  file reuses ingest and resampling for free.
- **Display-ready visuals.** The editor's waveform and spectrogram are computed
  server-side into compact representations (per-pixel peak envelopes, a quantised
  byte grid), so the browser renders at 60 fps without shipping raw samples.
- **Lazy, sample-rate-specific lanes.** Each model gets audio at exactly the rate
  it wants (44.1 kHz for separation, 16 kHz mono for pitch tracking), created once
  and shared, so no stage resamples redundantly.

## GPU and neural backends

The DSP floor runs on CPU by design. Neural backends (HTDemucs, RoFormer, Basic
Pitch, Apollo) are the quality tier and benefit from a GPU. When they load, the
**VRAM manager** (see [architecture.md](architecture.md)) governs memory with a
downgrade ladder — evict idle models → fp16 → shrink chunk → CPU fallback — so a
large model on a small GPU degrades to a slower path with a stated reason instead
of an out-of-memory crash. `neiro models` shows which backends are installed and
available on your machine.

## Roadmap performance targets

The roadmap (§11) sets budgets the project tracks toward: app interactive < 2 s,
first analysis result < 15 s for a typical song on a mid-range GPU, draft
separation faster than real time on GPU, and chunk-granular crash resume for long
jobs. The CPU DSP numbers above already meet the "faster than real time" bar for
the model-free lanes.
