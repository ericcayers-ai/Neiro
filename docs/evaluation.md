# Evaluation

Neiro's evaluation story has two layers that must never be confused:

1. **Always-on synthetic goldens** — small closed-form signals generated in
   process, scored by :mod:`neiro.eval`, run on every CI job. No downloads, no
   external licenses, no GPU required. This is the **release gate**.
2. **User-provisioned reference corpora** — MUSDB18-HQ, MAESTRO, MoisesDB,
   Slakh2100, GuitarSet, ENST/ADTOF. Multi-gigabyte, separately licensed. The
   runners **skip with a clear message and exit 0** when the corresponding env
   var is unset; they never invent scores. Published release-note numbers come
   from a provisioned machine.

Roadmap §12 / Phase 10 asks for the first of these to gate every release, and
for the second to be *ready* so a provisioned evaluation machine can produce
the numbers used in release notes. This page documents both.

## Always-on synthetic harness

| Piece | Location |
|-------|----------|
| Metrics (SDR, SI-SDR, bleed, residual loudness, note F1, perceptual distance) | `src/neiro/eval/metrics.py` |
| Synthetic golden corpus (≥30 closed-form cases) | `src/neiro/eval/corpus.py` |
| Shared suite runner / thresholds | `src/neiro/eval/report.py` |
| CLI | `python scripts/eval/run_synthetic.py` |
| CI assertions | `tests/test_eval_harness.py` (+ smoke in `tests/test_eval_synthetic.py`) |
| Perceptual proxy | `tests/test_perceptual.py` |
| Fault injection | `tests/test_robustness.py` |

```bash
python scripts/eval/run_synthetic.py            # human-readable table
python scripts/eval/run_synthetic.py --json -   # JSON to stdout
pytest tests/test_eval_harness.py tests/test_perceptual.py tests/test_robustness.py
```

### What is scored

- **Separation** — DSP-floor centre extraction on stereo mixtures with
  exact-known sources. Reports SDR, SI-SDR, rival-stem bleed (dB), and the
  residual-loudness null-test diagnostic. Pass threshold:
  `SEPARATION_SDR_THRESHOLD_DB = 3.0`.
- **Bleed suppression** — polluted target vs. a disjoint-frequency rival;
  must improve the bleed metric by at least
  `BLEED_IMPROVEMENT_THRESHOLD_DB = 1.0`.
- **Transcription** — YIN on clean monophonic sine tones with known onsets.
  Score is mir_eval-style note-level F1 (onset + pitch). Uses the real
  [`mir_eval`](https://github.com/craffel/mir_eval) package when installed,
  otherwise a local dependency-free matcher with the same semantics
  (`prefer_mir_eval=False` for forensics). Pass threshold:
  `TRANSCRIPTION_F1_THRESHOLD = 0.6`.
- **Perceptual distance (PEAQ/ViSQOL-class proxy)** —
  :func:`neiro.eval.metrics.perceptual_distance` combines log-mel spectral
  distance with loudness error. Identical signals score ~0; noisier estimates
  score higher. Optional real ViSQOL/PEAQ binaries may be used off-line; the
  in-tree proxy is what CI always runs.

Thresholds are deliberately *loose*: this corpus catches pipeline regressions
and crashes. Declaring a competitive quality win still needs a provisioned
MUSDB/MAESTRO run — see below.

### Fault injection (roadmap §12 robustness)

`tests/test_robustness.py` covers the non-metric half of the harness:

- Corrupt WAV bytes raise rather than hang.
- Unknown model ids miss loudly (`KeyError` / `None`).
- Mid-job cancel raises `CancelledError`.
- A corrupted on-disk cache entry is evicted and recomputed.

## Human listening protocol (ensemble / enhancement weight changes)

When changing default ensemble weights or enhancement chain defaults:

1. Pick three short clips (vocals-forward pop, dense rock, degraded archival).
2. Render A (previous defaults) and B (candidate) with identical seeds.
3. Blind A/B on headphones; note preference for bleed, artifacts, and naturalness.
4. Record the decision and clips in the PR description (or an issue linked from the PR).
5. Keep the automated SDR/F1/perceptual-distance suite green in the same PR.

This is the periodic human listening gate from roadmap §12; it does not replace
the synthetic CI suite.

## External corpora (opt-in)

Full benchmark corpora are **not** vendored (license + size). Set the env var
and run the corresponding script when you have licensed local access:

| Corpus | Env var | Runner | Metrics |
|--------|---------|--------|---------|
| MUSDB18-HQ | `NEIRO_EVAL_MUSDB` | `python scripts/eval/run_musdb.py` | SDR / SI-SDR / bleed per stem |
| MAESTRO | `NEIRO_EVAL_MAESTRO` | `python scripts/eval/run_maestro.py` | note-level F1 vs. MIDI |
| MoisesDB | `NEIRO_EVAL_MOISES` | `python scripts/eval/run_extra_corpora.py` | readiness + future multi-stem |
| Slakh2100 | `NEIRO_EVAL_SLAKH` | `python scripts/eval/run_extra_corpora.py` | readiness + multi-instrument |
| GuitarSet | `NEIRO_EVAL_GUITARSET` | `python scripts/eval/run_extra_corpora.py` | readiness + tab/guitar |
| ENST/ADTOF | `NEIRO_EVAL_ENST` | `python scripts/eval/run_extra_corpora.py` | readiness + drums |

When the env var is unset (or points at a directory that doesn't look like the
expected layout), the runner prints an actionable skip message and exits **0**.
That is intentional — CI must never fail because a developer hasn't accepted a
dataset's terms.

### Obtaining the datasets

- **MUSDB18-HQ** — [sigsep.github.io/datasets/musdb](https://sigsep.github.io/datasets/musdb.html).
  Decode to the standard layout: `<root>/train/<track>/{mixture,vocals,drums,bass,other}.wav`
  and the same under `<root>/test/`. Point `NEIRO_EVAL_MUSDB` at `<root>`.
- **MAESTRO** — [magenta.tensorflow.org/datasets/maestro](https://magenta.tensorflow.org/datasets/maestro).
  Use a v2/v3 tree with `maestro-v*.csv` at the root. Point
  `NEIRO_EVAL_MAESTRO` at that root.
- **MoisesDB / Slakh / GuitarSet / ENST** — obtain under each dataset's own
  license, then point the corresponding `NEIRO_EVAL_*` env var at the root.
  `run_extra_corpora.py --json` reports readiness.

### Typical local runs

```bash
# DSP floor, no downloads (safe default for smoke / CI-on-a-laptop):
set NEIRO_EVAL_MUSDB=D:\datasets\musdb18hq          # PowerShell: $env:NEIRO_EVAL_MUSDB=...
python scripts/eval/run_musdb.py --preset vocals --limit 5 --json musdb.json

# Neural 4-stem bench (downloads weights on first use):
python scripts/eval/run_musdb.py --preset 4stem --auto-download --limit 0

# Piano transcription (DSP floor):
set NEIRO_EVAL_MAESTRO=D:\datasets\maestro-v3.0.0
python scripts/eval/run_maestro.py --model dsp-yin --limit 3 --json maestro.json

# Extra corpora readiness check:
python scripts/eval/run_extra_corpora.py --json
```

Record provisional scores under `docs/` or the release notes only after a full
split run on a provisioned machine. The synthetic suite alone is **not** a
substitute for competitive published rankings — but it **is** the verified
release gate for requirements **R-0116**–**R-0119** and the Phase 10 golden-
corpus gate (**R-0203**).

## Honest quality (roadmap §12)

Displayed and published quality numbers come from this harness. Marketing
claims without a row in a suite report (synthetic or provisioned) are out of
scope. If a change improves measured SDR/F1, tighten the relevant threshold
with the evidence in the same PR; do not lower a threshold just to keep CI green.
