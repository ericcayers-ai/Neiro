# Security, licence and release audit — 2026-11-08

Purpose: decide whether this tree can be pushed to a **public** GitHub repository.
Every row below is a command that was run in this pass, not an inference.

Tree audited: `main` @ `e11ce6f` + the working-tree changes listed in §4.
Machine disk state during the pass: 3.6 GB free on `C:` (a full build is not possible;
see §5).

## 1. Mechanical security scan

| Check | Command | Result |
|---|---|---|
| Repo scanner (11 codes) | `python ~/.dsh/skills/cybersafe/scripts/cybersafe_scan.py .` | **0 findings**, 1,218 files |
| Secret + private-data scan (tree and **full history**) | custom scanner, 14 patterns (AWS, GitHub, OpenAI/Anthropic/HF/Google/Slack/Stripe keys, private-key blocks, JWT, bearer literals, password assignments, DB URLs, emails, phone numbers, local user paths) | **0 tree hits** after the fixes in §4; history holds only the maintainer's own contact address in old `SECURITY.md` / `CODE_OF_CONDUCT.md` revisions and in signed tags |
| Local-path leak | `git grep -E "[Cc]:[\\\\/]Users"` | 22 hits in 9 files before §4; **0** after |
| Private harness references (`~/.dsh`, `~/.pi`, `reelkit`) | `git grep -E "~/\\.(dsh|pi)"` | 3 hits in 2 files before §4; **0** after |

The public-build secret scan also covered the pre-release and release workflows: the only
secret references are the four Tauri signing-key uses in `release.yml`, which are gated and
never echoed.

## 2. Licence audit

Measured from the installed `.venv` (24 distributions) and `frontend/node_modules`
(93 packages), plus every model manifest in `src/neiro/manifests/`.

| Surface | Result |
|---|---|
| Neiro code, engine + frontend + addon + shell | MIT (`LICENSE`) |
| Python runtime deps | NumPy BSD-3, SciPy BSD-3, soundfile BSD-3 — all permissive |
| Python installed distributions | only PyInstaller is GPLv2 **with the bootloader exception**; it is a packaging tool, never imported by the app |
| Frontend dependencies | 67 MIT, 6 Apache-2.0, 3 MPL-2.0, 3 OFL-1.1, 2 BSD-2, 2 BSD-3, 2 ISC, plus dual MIT/Apache — **no GPL/AGPL/SSPL/NC anywhere** |
| Rust crates | Tauri stack, MIT/Apache-2.0, pinned by `Cargo.lock` |
| Model weights | **not bundled**. 36 manifests MIT, 12 `unknown`, 1 GPL-3.0 (`enh-matchering`, marked "copyleft — relevant for redistribution") — each is a download the user opts into and each is labelled in `docs/models.md` |
| Third-party code | no vendored library, no `rb.wasm`, no Transpose assets/locales. Only two tracked files exceed 200 kB: the built SPA bundle and the macOS icon |
| Lockfiles | `frontend/package-lock.json` and root lockfile are byte-consistent with their `package.json` (0 mismatches), so CI `npm ci` resolves deterministically |

### Known-vulnerability scan (Dependabot, after the repo went public)

`npm audit` (frontend) reported 4 (nanoid, postcss, source-map-js, vite) — all
development-scope and all fixable in-range: `npm audit fix` → **0 vulnerabilities**, and
the frontend build, 153 vitest tests and oxlint still pass on the new lockfile.

Dependabot opened 11 alerts against `src-tauri/Cargo.lock` and `frontend/package-lock.json`:

| Package | Scope | Action |
|---|---|---|
| `zip` 4.6.1 (critical Zip-Cloaking RCE, high symlink-exhaustion, medium HMAC bypass) | runtime, via `tauri-plugin-updater` | `cargo update -p tauri-plugin-updater` → plugin 2.14.1 → **zip 9.4.2**, above every patched threshold (9.0.0 / 9.0.5) |
| `vite` 8.1.5, `launch-editor`, `source-map-js`, `postcss` | development only | fixed by the `npm audit fix` lockfile update |
| `glib` 0.18.5 (unsound `Iterator` impl, Linux GTK binding) | runtime on Linux | **cannot be fixed in this repo**: glib 0.20 ships in the next gtk-rs generation, which `wry`/`tao` do not use yet. The alert is dismissed as `tolerable_risk` with the reason written into it, not silently ignored. |

`THIRD_PARTY_NOTICES.txt` was extended with the packaging tool, `smplr`, the MPL-2.0
build-time packages and the explicit "no copyleft in shipped code" statement.

## 3. Gate

`python scripts/verify_goal.py --full` on the pre-fix tree: **21/23**.

- **C3 FAIL** — `ruff` 0.17.1 reported an unused import and two unformatted files.
  Fixed (§4); `ruff check .` and `ruff format --check .` are both clean now.
- **C23 FAIL** — `cargo clippy/test` died with `os error 112` (disk full) after writing
  2.83 GB of debug artifacts. `C:` has 3.6 GB free and no volume has more, so the Rust
  gate cannot run on this machine at all (the build guard refuses below 10 GB).
  `cargo fmt --check` passes locally, and **CI ran the full Rust job — `cargo fmt`,
  `clippy -D warnings`, `cargo test --lib`, `cargo check` — green on ubuntu-latest for
  commit `7208fdf`**, which closes C23 with an independent runner.

Local run of every other criterion (`--full --only C1…C22`) after the fixes: **22/22 PASS**,
including 300 Python tests (3 skipped), the frontend `tsc -b` + Vite build, 153 vitest
tests, 49 addon checks, static a11y 0 findings.

### CI on the first public commit (`5fdf0ca` → fixed in `7208fdf`)

14 jobs, 3 failed, and every failure was a real defect the local gate could not see:

| Job | Failure | Fix |
|---|---|---|
| Frontend lint, typecheck, build | oxlint **error** `rules-of-hooks`: `useSceneNow` is a plain function called inside a callback (`PlayerSurface.tsx:1179`) | renamed to `applySceneNow`; `oxlint` now exits 0 (17 warnings remain, none fatal) |
| Rust fmt, clippy, check | `clippy::filter_next` under `-D warnings` (`src-tauri/src/lib.rs:367`) | `filter(..).next_back()` → `rfind(..)` |
| Test ×3 (macOS) | `test_dynamic_port` timed out at 30 s and, because the child's output sat in an unread pipe, reported nothing | the test now runs the child unbuffered, stops polling on exit, allows 60 s and raises with the child's output, exit code and platform |

Re-run on `7208fdf`: **14/14 jobs green** (Python lint, Windows/Ubuntu/macOS × py3.10-3.12,
frontend, addon, Rust, packaging smoke).

## 4. Defects found and fixed

1. **Path-traversal prefix collision (`src/neiro/ui/server.py`)** — `/files/<rel>` was
   contained with `str(target).startswith(str(workspace))`. A sibling directory named
   `<workspace>-evil` therefore passed the check and could be served. Reproduced with a
   raw HTTP request (`GET /files/../neiro-ui-…-evil/secret.txt` → **200** before the fix,
   **404** after); the same fix applied to `/api/soundfonts/`. Regression test:
   `tests/test_ui_server.py::test_file_route_rejects_a_sibling_sharing_the_workspace_prefix`
   (covers `..`, `%2e%2e` and `..%2f` encodings, plus a positive control).
2. **Unscoped destructive SQL — two code sites, four scanner hits**
   (`src/neiro/library/store.py`, `src/neiro/ui/library_api.py`) — the library reset ran
   `DELETE FROM songs` / `playlist_items` / `scenes` from the HTTP layer, reaching into
   `store._connect()`. Replaced with `LibraryStore.reset(confirm=...)`: an id-scoped
   delete per song inside one transaction (foreign keys are on, so children cascade),
   plus `DELETE FROM scenes WHERE song_id IS NULL` for scenes the cascade cannot reach.
   `PRAGMA user_version` now stringifies an `int` instead of interpolating an f-string.
   Behaviour is unchanged and now covered by
   `tests/test_library.py::test_store_reset_requires_confirm_and_cascades_children` and
   `::test_api_library_reset_leaves_no_song_less_scenes`.
3. **`SECURITY → if` in the release workflow** — `release.yml` used
   `if: secrets.TAURI_SIGNING_PRIVATE_KEY != ''`, but the `secrets` context is not
   available in `if`; that workflow would fail validation. The key's presence is now
   resolved into a job-level `env.HAS_SIGNING_KEY` and tested from there.
4. **CI formatter drift** — the lint job installed an unpinned `ruff`, so a formatter
   release can turn `main` red without a code change (it did: 0.17.1 reformats lines that
   an earlier version kept split). Pinned to `ruff==0.17.1`.
5. **Machine-local paths in 9 tracked files** (`GOAL.md`, `HANDOFF.md`, `desk.gate.json`,
   `docs/AUDIT.md`, `docs/CONVENTIONS.md`, `docs/REEL-ADOPTION-2026-10-27.md`,
   `docs/evidence/*`) — the account name, the private harness layout, a sibling private
   repo's path and the local build path. Replaced with `<repo>`, `<local path>` or a plain
   description; `desk.gate.json` now launches `src-tauri/target/release/neiro.exe`
   relative to the repo.

## 5. Open, and why

- **Gate C23** cannot run on this machine (`C:` has 3.6 GB free; the build guard refuses
  below 10 GB). It is verified by CI instead — see §3. Re-run locally when disk allows.
- **No secret was found in history**, but history contains the maintainer's own contact
  address in superseded `SECURITY.md`/`CODE_OF_CONDUCT.md` revisions and in signed tags.
  Rewriting history was not done; the current files carry no address.
- The desktop installer remains **unsigned** and the shell still needs a system Python
  unless the optional PyInstaller sidecar is installed. That is a known release gap
  recorded in `HANDOFF.md`, not a defect introduced here.
- oxlint reports 17 `exhaustive-deps` / `only-export-components` **warnings**. They are
  advisory, they do not fail CI, and several encode deliberate effect scoping; rewriting
  them changes runtime behaviour and belongs in its own change.

## 6. Repository settings (public)

| Setting | Before | Now |
|---|---|---|
| Visibility | private | **public** |
| Default branch | `main` @ `c3cc5c0` (177 commits behind local) | `main` @ `7208fdf` |
| Secret scanning | enabled | enabled |
| Secret scanning push protection | enabled | enabled |
| Non-provider patterns / validity checks | disabled | disabled (API refuses to enable on this account; base scanning is on) |
| Private vulnerability reporting | **disabled** (while `SECURITY.md` told reporters to use it) | **enabled** |
| Dependabot alerts | disabled | **enabled**, 0 open alerts |
| Dependabot security updates | disabled | **enabled** |
| Discussions / issues / wiki | on | on (`CONTRIBUTING.md` links Discussions) |

## 7. Verdict

The tree is safe to publish: no secrets, no private data, no copyleft in shipped code,
all dependency and model licences permissive or honestly labelled, the one scanner
finding class fixed at the source rather than suppressed, and a green 14-job CI matrix on
the published commit.
