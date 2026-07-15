# Contributing to Neiro

Thanks for your interest. Neiro is a local-first audio application with a
model-agnostic engine, spanning three languages/runtimes:

- **`src/neiro/`** — the Python engine: DAG runtime, VRAM manager, model registry,
  DSP floor, CLI, and the local HTTP server the UI talks to.
- **`frontend/`** — the TypeScript + React worksuite (Import, Analysis, Studio,
  Separate, Restore, Transcribe, Mixer, Learn, Preferences, About).
- **`src-tauri/`** — the Rust/Tauri 2 desktop shell that supervises the Python
  engine process and hosts the frontend as a native window.

The most valuable contributions tend to be:

- **New model adapters** — wrap a separation / transcription / restoration model
  behind the uniform interface (see [`docs/adding-models.md`](docs/adding-models.md)).
  This is deliberately the *lowest-friction* contribution: a manifest plus an
  adapter, no core changes.
- **DSP and analysis improvements** — the model-free floor (separation, pitch,
  restoration, the analysis pass) should stay strong for users without GPUs.
- **Frontend/UX work** — worksuite modules, accessibility, the design language in
  [`docs/ui.md`](docs/ui.md).
- **Correctness fixes** with a regression test that fails before and passes after.

## Development setup

### Python engine

```bash
git clone https://github.com/ericcayers-ai/Neiro
cd Neiro
python -m venv .venv && . .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
pytest
```

`ffmpeg` on `PATH` is only needed to decode compressed/video inputs; WAV/FLAC
work without it, and the test suite doesn't require it.

### Frontend

```bash
npm --prefix frontend ci
npm --prefix frontend run dev     # Vite dev server, proxies /api to the engine
npm --prefix frontend run build   # type-check + production build
npm --prefix frontend run lint    # oxlint
```

Run `neiro ui --no-browser` in another terminal so the dev server has an engine to
talk to.

### Desktop shell (Rust/Tauri)

```bash
npm install                        # repo root: installs the Tauri CLI
cd src-tauri
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo check
cd ..
npm run tauri:dev                  # builds the frontend, launches the desktop shell
```

The shell needs a working Python environment with `neiro` importable on `PATH`
(the same one you set up above); it spawns `python -m neiro.cli ui --no-browser`.

## Before you open a PR

Run the same checks CI runs, for whichever part of the stack you touched:

```bash
# Python
ruff check .          # lint
ruff format .         # format (or --check to verify)
pytest                # tests
pytest --cov=neiro    # with coverage
python scripts/verify_models.py   # manifest sanity check

# Frontend
npm --prefix frontend run lint
npm --prefix frontend run build

# Rust
(cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo check)
```

Guidelines:

- **Match the surrounding style.** Every Python module has a docstring explaining
  *why* it exists and which roadmap section it implements — keep that convention.
- **Type-hint public functions.** The Python package ships `py.typed`; the
  frontend is TypeScript throughout — avoid `any` unless justified in a comment.
- **Test behaviour, not implementation.** DSP tests synthesize audio and assert
  on measurable properties (reconstruction error, SNR gain, detected pitch, SDR),
  so they stay valid across refactors. Follow that pattern; see
  [`docs/evaluation.md`](docs/evaluation.md) for the metrics harness.
- **Keep the core dependency-light.** Heavy backends (torch, demucs, basic-pitch)
  are *optional extras* and must be imported lazily inside an adapter's `load()`,
  never at module top level. The engine must import and run on numpy/scipy alone.
- **Never commit** model weights, audio files, datasets, or other large binaries.
  The `.gitignore` blocks the common cases; don't work around it. Full
  MUSDB18-HQ/MAESTRO-class evaluation datasets are always user-provisioned via
  environment variables — see [`docs/evaluation.md`](docs/evaluation.md).

## Adding a model

Models are JSON manifests, not code changes to the core. The full guide is in
[`docs/adding-models.md`](docs/adding-models.md). In short: drop a manifest in
`src/neiro/manifests/`, point its `adapter` at a class implementing the relevant
protocol from `neiro.nodes.base`, declare `requires` and an accurate `license`,
and it appears in `neiro models` immediately. See also
[`docs/models.md`](docs/models.md) for the current registry.

**Licensing matters.** Many state-of-the-art audio models are non-commercial or
research-only. The `license.spdx` field is surfaced in the UI and carried into
export metadata; getting it right is a correctness requirement, not a formality.
If a model's license is ambiguous or you are not the rights holder for re-hosted
weights, say so explicitly in `license.note` and in the PR description — reviewers
will not merge a manifest with an unverified license claim. Do not commit weight
files themselves; manifests reference a URL/hash and the registry downloads on
demand.

## Reporting bugs & proposing features

Use the issue templates — there's one each for bugs, feature requests, model
adapter proposals, performance regressions, accessibility issues, and
documentation gaps. For questions and design discussion, prefer
[Discussions](https://github.com/ericcayers-ai/Neiro/discussions). For security
issues, follow [`SECURITY.md`](SECURITY.md) — do not open a public issue. General
"how do I…" questions also welcome via [`SUPPORT.md`](SUPPORT.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## License

By contributing, you agree that your contributions — Python, TypeScript, Rust, or
documentation — are licensed under the project's [MIT License](LICENSE). Model
weights you reference keep their own licenses; your adapter/manifest code is MIT.
