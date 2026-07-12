# Contributing to Neiro

Thanks for your interest. Neiro is a local-first audio engine with a
model-agnostic architecture, and the most valuable contributions tend to be:

- **New model adapters** — wrap a separation / transcription / restoration model
  behind the uniform interface (see [`docs/adding-models.md`](docs/adding-models.md)).
  This is deliberately the *lowest-friction* contribution: a manifest plus an
  adapter, no core changes.
- **DSP and analysis improvements** — the model-free floor (separation, pitch,
  restoration, the analysis pass) should stay strong for users without GPUs.
- **Correctness fixes** with a regression test that fails before and passes after.

## Development setup

```bash
git clone https://github.com/ericcayers-ai/Neiro
cd Neiro
python -m venv .venv && . .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
pytest
```

`ffmpeg` on `PATH` is only needed to decode compressed/video inputs; WAV/FLAC
work without it, and the test suite doesn't require it.

## Before you open a PR

Run the same checks CI runs:

```bash
ruff check .          # lint
ruff format .         # format (or --check to verify)
pytest                # tests
pytest --cov=neiro    # with coverage
```

Guidelines:

- **Match the surrounding style.** Every module has a docstring explaining *why*
  it exists and which roadmap section it implements — keep that convention.
- **Type-hint public functions.** The package ships `py.typed`.
- **Test behaviour, not implementation.** DSP tests synthesize audio and assert
  on measurable properties (reconstruction error, SNR gain, detected pitch), so
  they stay valid across refactors. Follow that pattern.
- **Keep the core dependency-light.** Heavy backends (torch, demucs, basic-pitch)
  are *optional extras* and must be imported lazily inside an adapter's `load()`,
  never at module top level. The engine must import and run on numpy/scipy alone.
- **Never commit** model weights, audio files, or other large binaries. The
  `.gitignore` blocks the common cases; don't work around it.

## Adding a model

Models are JSON manifests, not code changes to the core. The full guide is in
[`docs/adding-models.md`](docs/adding-models.md). In short: drop a manifest in
`src/neiro/manifests/`, point its `adapter` at a class implementing the relevant
protocol from `neiro.nodes.base`, declare `requires` and an accurate `license`,
and it appears in `neiro models` immediately.

**Licensing matters.** Many state-of-the-art audio models are non-commercial or
research-only. The `license.spdx` field is surfaced in the UI and carried into
export metadata; getting it right is a correctness requirement, not a formality.

## Reporting bugs & proposing features

Use the issue templates. For questions and design discussion, prefer
[Discussions](https://github.com/ericcayers-ai/Neiro/discussions). For security
issues, follow [`SECURITY.md`](SECURITY.md) — do not open a public issue.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE). Model weights you reference keep their own
licenses; your adapter code is MIT.
