# Evaluation

Neiro ships two evaluation layers:

## Always-on synthetic harness (CI)

Located in `tests/test_eval_synthetic.py` and related robustness tests:

- Synthetic stereo mixtures exercise center-extract SI-SDR and residual loudness
- Local note-level F1 (mir_eval-compatible) without requiring MIR toolkits
- Fault injection: corrupt files, missing models, cancel mid-job, cache corruption

These run on every CI job. Failures block release.

## External corpora (opt-in)

Full benchmark corpora are **not** vendored (license + size). Set environment
variables and run the corresponding scripts when you have licensed access:

| Corpus | Env var | Purpose |
|--------|---------|---------|
| MUSDB18-HQ | `NEIRO_EVAL_MUSDB` | Separation SDR / SI-SDR / bleed |
| MoisesDB subset | `NEIRO_EVAL_MOISES` | Multi-stem separation |
| MAESTRO | `NEIRO_EVAL_MAESTRO` | Piano transcription F1 |
| Slakh2100 / GuitarSet / ENST | `NEIRO_EVAL_*` | Multi-instrument / drums |

When the env var is unset, the optional runners print a clear skip reason and exit
0 — they never fake scores. Declaring roadmap 1.0 quality targets against those
corpora requires running them at least once on a provisioned evaluation machine
and recording the scores under `docs/` / release notes.

## Golden artifacts

Synthetic golden WAV/MIDI fixtures live under `tests/fixtures/` when present, and
are regenerated intentionally under review. Pipeline changes that alter DSP
outputs must update goldens in the same PR with a rationale.
