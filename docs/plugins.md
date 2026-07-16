# Plugins & extension points

Neiro's only sanctioned way to extend behavior is through the model registry —
manifests plus adapters (roadmap §10). There is deliberately no general plugin
API for the engine's core graph today. This page inventories every extension
point that exists, what trust boundary each one crosses, and what's still
roadmap-only.

## 1. Model manifests + adapters (implemented, the main mechanism)

See [`docs/adding-models.md`](adding-models.md) for the how-to and
[`docs/models.md`](models.md) for the current roster. In short: drop a JSON
manifest in a scanned directory naming an `adapter: "module:Class"`; the
registry imports and instantiates it on demand.

**Trust boundary:** an adapter is ordinary Python that runs in the same process
as the engine, with the same filesystem/network access. Adding a manifest is
equivalent to adding a dependency — review it like one. This is why
[`CONTRIBUTING.md`](../CONTRIBUTING.md) requires an accurate `license.spdx` and a
real, checkable weight source before a manifest is merged: manifests are not
sandboxed, and a malicious adapter or a malicious weight file (see
[`SECURITY.md`](../SECURITY.md#model-weights-a-supply-chain-note)) has full
process privileges.

## 2. Signed model index (implemented as a primitive, not yet wired to a remote feed)

`neiro.engine.signing` provides `sign_index` / `verify_index` / `load_signed_index`
/ `write_signed_index` — HMAC-SHA256 signing over a canonical JSON encoding of a
registry index payload. This is the building block for roadmap §10.1's "signed
JSON index the app can refresh" (`R-0107`): a maintainer signs a curated index of
manifests with a private secret; the app verifies the signature before trusting
entries from it.

**Current status:** the primitives exist and are tested
(`tests/test_signing.py`), but nothing yet fetches or auto-applies a *remote*
signed index — `default_registry()` still only scans the local
`src/neiro/manifests/` directory. `load_signed_index` degrades honestly when no
secret is configured: an unsigned index is labeled `"_verification": "unsigned"`
rather than silently treated as trusted, and a signature with no verifying secret
present is labeled rather than assumed valid.

**Trust boundary:** verifying a signature only proves an index wasn't tampered
with in transit/storage relative to whoever holds the signing secret — it does
not vouch for the licensing or safety of the models the index *points at*.
That's still the manifest review process in §1.

## 3. Watch-folder daemon (implemented)

```bash
neiro watch ./inbox --out ./done --job separate --preset vocals [--once] [--poll 2.0]
```

`neiro.io.watch` polls an input directory for new/changed audio (fingerprinted by
path + mtime + size so a file is never reprocessed until it actually changes),
runs a configured planner job (`separate` / `transcribe` / `enhance`), and writes
artifacts to an output directory — headless, safe to run alongside the UI
(roadmap §2.1 "headless mode", `R-0011`). This is the batch-processing extension
point for users who want Neiro driven by *their* automation (a folder synced from
elsewhere, a cron job, another app's export hook) rather than a plugin loaded
into Neiro's own process.

**Trust boundary:** the daemon runs with the permissions you invoke it with, same
as any other CLI command; it does not load third-party code beyond the models
you've already installed.

## 4. Custom Python adapter plugins (MVP)

Roadmap §10.1 (`R-0108`) now has a small local-only MVP for power users who want
to register their own Python adapters without editing the packaged manifest
directory. Neiro scans:

```text
~/.neiro/plugins/*/plugin.json
~/.neiro/plugins/grants.json
```

Each `plugin.json` uses this schema:

```json
{
  "name": "My Separator",
  "adapter": "my_package.neiro_plugin:MySeparator",
  "role": "separator",
  "enabled": true
}
```

`role` must be one of:

| Role | Registry task |
|---|---|
| `enhancer` | `enhance` |
| `separator` | `separate` |
| `transcriber` | `transcribe` |

Descriptors are visible through `GET /api/plugins`, but a plugin only becomes a
registry entry when **both** `enabled` is true and `grants.json` explicitly grants
it:

```json
{
  "granted": {
    "my-separator": true
  }
}
```

You can update grants with `POST /api/plugins`:

```json
{ "plugin": "my-separator", "granted": true }
```

or:

```json
{ "grants": { "my-separator": true, "old-plugin": false } }
```

**Trust boundary:** a granted adapter is ordinary Python running in the Neiro
process. There is no sandbox. Only grant plugins whose source you trust; review
them like any other dependency.

## 5. Desktop shell IPC surface (implemented, intentionally minimal)

The Tauri shell (`src-tauri/`) exposes exactly two commands to the frontend —
`engine_status` and `restart_engine_cmd` — both read-only/supervision-only (see
[`docs/architecture.md`](architecture.md#desktop-shell--frontend)). It is not a
plugin host: there is no mechanism for the frontend or a third party to register
new native commands without a source change to `src-tauri/src/lib.rs`, and the
window's Content-Security-Policy blocks the renderer from reaching anything but
the local engine origin. This is deliberate — broadening it is a security-relevant
change and should go through [`SECURITY.md`](../SECURITY.md)'s reporting process
if you believe there's a gap, or a normal PR with review if you're proposing a
new, deliberately-scoped command.

## 6. DAW VST injector (implemented — shared window)

See [`docs/daw-vst.md`](daw-vst.md). A VST2 effect (`plugins/neiro-vst`) inserts
into any DAW as a pass-through injector. Opening its editor focuses the **single**
Neiro window (Learn) via `POST /api/daw/show-ui` instead of embedding a second UI.
Install with `./scripts/install_daw_plugin.sh`.

**Trust boundary:** the plug-in only talks to `127.0.0.1:8377` (the local engine).
It does not load third-party code beyond what Neiro already runs.
