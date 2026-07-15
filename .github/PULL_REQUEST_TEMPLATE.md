<!-- Thanks for contributing to Neiro. Keep PRs focused; small is reviewable. -->

## What & why

<!-- What does this change, and what problem does it solve? Link any issue: Closes #123 -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] New model adapter / manifest
- [ ] Frontend / UI
- [ ] Desktop shell (Tauri/Rust)
- [ ] Docs
- [ ] Refactor / internal
- [ ] CI / tooling / packaging

## Checklist

General:

- [ ] PR is scoped to one change; unrelated cleanups are split out
- [ ] Updated docs / `CHANGELOG.md` if user-facing
- [ ] No model weights, audio, datasets, or other large binaries committed

Python engine (if touched):

- [ ] `ruff check .` and `ruff format --check .` pass
- [ ] `pytest` passes locally; added/updated tests for the change
- [ ] `python scripts/verify_models.py` passes (if manifests touched)
- [ ] Heavy dependencies stay lazily imported inside adapter `load()`, not at module top level

Frontend (if touched):

- [ ] `npm --prefix frontend run lint` passes
- [ ] `npm --prefix frontend run build` passes (typecheck + production build)
- [ ] Keyboard operability and ARIA labeling checked for new interactive elements (see `docs/ui.md`)

Desktop shell / Rust (if touched):

- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy --all-targets -- -D warnings` passes
- [ ] `cargo check` passes
- [ ] Any new IPC command is deliberate and documented — no broadened filesystem/process access

New model / manifest (if applicable):

- [ ] Manifest includes an accurate `license.spdx` (see `CONTRIBUTING.md`) with a real source link
- [ ] Manifest declares `requires` so unavailability is detected, not a crash
- [ ] A test exercises the adapter's contract (even a synthetic-signal smoke test)

## Notes for reviewers

<!-- Anything non-obvious: trade-offs, follow-ups, things you're unsure about. -->
