# Session format

A Neiro session is a portable JSON document (`neiro.engine.session`) that pins
everything needed to explain, audit, or reproduce a piece of work: the source
file's fingerprint, the graph configuration that produced each artifact, which
model IDs and weight hashes were used, licenses, edit history, and in-flight job
checkpoints. This is the concrete mechanism behind roadmap principle 2 ("every
output can be traced to the exact models, versions, and parameters that produced
it") and §10.2's version-pinning requirement.

## Why a session file, not just a cache

The content-addressed [artifact cache](architecture.md#graph-runtime-neiroenginegraph)
already gives you *fast* re-runs on one machine. A session gives you a
*portable, human-inspectable* record you can hand to someone else, store next to
a project, or diff against an older run — independent of whether the cache that
produced it still exists.

## Document shape

```python
from neiro.engine.session import SessionDocument, SessionStore, ModelPin, file_fingerprint

doc = SessionDocument(
    name="my-song",
    source=file_fingerprint(Path("song.flac")),   # {path, sha256, size, mtime_ns}
    graph_config={"preset": "vocals-neural-ensemble", "tier": "reference"},
    models=[ModelPin(model_id="bs-roformer-1297", weight_sha256="…", license_spdx="MIT")],
)

store = SessionStore()          # defaults to the platform Neiro home (see below)
path = store.save(doc)          # writes <name>.neiro.json
reopened = store.load(path)
```

| Field | Purpose |
|---|---|
| `session_version` | Schema version; `SessionStore.load` refuses to open a session from a *newer* app and records a migration note when opening an *older* one. |
| `source` | The input file's fingerprint (path, SHA-256, size, mtime) — how a reopened session detects "this source file changed since last time." |
| `graph_config` | The preset/tier/parameters passed to the planner — enough to reconstruct the same graph. |
| `models` | `ModelPin` entries: model ID, weight hash, and license at the time the job ran. Reopening with different weights installed is a "reproduce exactly (fetch pinned weights) vs. re-run with current models" decision — the roadmap's version-pinning requirement (§10.2, `R-0109`). |
| `artifacts` | Content-cache keys for the artifacts this session produced, so a session can be handed to `ArtifactCache` to reuse work without recomputation. |
| `edits` | User edits (Studio trims/gain/etc., transcription corrections) applied on top of computed artifacts — never destructive to the originals. |
| `checkpoints` | `JobCheckpoint` entries (completed nodes/chunks, status) — the hook long-running jobs use to resume after a crash rather than restarting from zero. |
| `analysis_corrections` | User overrides to the `AnalysisReport` ("that's a Rhodes, not a piano") that should propagate to routing on reopen. |

## Storage location

`SessionStore()` with no argument defaults to `<Neiro home>/sessions/`:

- Windows: `%LOCALAPPDATA%\Neiro\sessions`
- macOS/Linux: `~/.neiro/sessions`

This deliberately avoids `%LOCALAPPDATA%`-adjacent cloud-sync folders (roadmap
§14 "cloud-synced folders" risk, `R-0200`) — the same reasoning that keeps the
model cache and artifact cache out of `OneDrive`-style directories by default.
Pass an explicit `root` to `SessionStore(root=...)` to point elsewhere (e.g. a
project folder you want to sync deliberately).

## Current status

The session format and store are implemented and tested
(`tests/test_session_and_bleed.py`), and are the write-once target for
provenance going forward. **Not yet wired:** the UI doesn't yet expose "save
session" / "open session" as a user action (roadmap `R-0109`, `M6 — Openness`);
today it's a library building block the CLI and engine can already use for
scripted/batch workflows (see `neiro watch`, [`docs/plugins.md`](plugins.md#watch-folder-daemon)).
Contributions wiring session save/open into the Preferences or About module are
welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md).
