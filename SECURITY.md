# Security Policy

## Supported versions

Neiro 1.2.x is current; security fixes land on `main` and in the next tagged release.
The latest release is the only supported version across all three parts of the
stack (Python engine, frontend, desktop shell) — they are versioned and released
together.

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
| 1.2.x   | ✅        |
| 0.4.x   | security fixes only until 2026-10-01 |
| < 0.4   | ❌        |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on the repository) with:

- a description of the issue and its impact,
- which surface it affects (Python engine / CLI, the local HTTP UI, the frontend,
  or the Tauri desktop shell),
- steps to reproduce, and
- affected version(s).

You can expect an acknowledgement within a few days and a fix or mitigation plan
once the report is confirmed. Please give a reasonable window (90 days is a
sensible default) to address the issue before any public disclosure. Credit is
given in the release notes unless you ask not to be named.

## Security model & scope

Neiro is a **local-first** application. Its design keeps the attack surface small
across every layer:

- **No network egress by default.** The engine processes audio locally and does
  not transmit audio anywhere. The only outbound network activity is *explicit,
  user-initiated* model downloads and application updates.
- **The interface binds to `127.0.0.1` only.** The `neiro ui` server is not
  exposed to the local network or the internet, whether reached from a browser or
  from the Tauri desktop window. File serving is confined to a per-session
  temporary workspace, and paths are resolved and checked against that workspace
  root to prevent traversal (regression-tested).
- **The desktop shell has a locked-down CSP.** `src-tauri/tauri.conf.json`
  restricts `connect-src`/`img-src`/`media-src` to the local engine origin only,
  disallows framing, and the shell process only ever talks to `127.0.0.1:8377`.
- **No secrets, tokens, or credentials** are stored or required by the core.

### What we consider in scope

- Path traversal or workspace escape in the local UI server.
- Crashes or resource exhaustion triggered by crafted **audio** input (the parser
  is expected to reject or degrade gracefully, never execute).
- Any code path that would cause audio or user data to leave the machine
  unexpectedly.
- Command injection or unsafe subprocess use in the Python engine (`ffmpeg`
  invocations, model downloaders) or in the Rust shell's engine-process
  supervision.
- Content-Security-Policy or IPC bypasses in the Tauri shell that would let a
  compromised/rendered page reach the filesystem or spawn processes outside the
  declared `invoke_handler` surface.
- Supply-chain issues in pinned dependencies (Python, npm, Cargo) — see Dependabot
  coverage below.

### Multi-language dependency surface

Dependencies are tracked and updated automatically across all three ecosystems via
Dependabot (`.github/dependabot.yml`): `pip` (root), `npm` (`frontend/` and the
repo root's Tauri CLI tooling), and `cargo` (`src-tauri/`). If you find a
vulnerable transitive dependency that Dependabot hasn't yet flagged, reporting it
through the process above is welcome even if it isn't exploitable in Neiro's
specific usage — we'd rather bump early.

### Model weights: a supply-chain note

Neiro loads third-party model weights through manifests. Weights are **code-like
artifacts** — a malicious checkpoint can be dangerous. Mitigations in place and
planned:

- Manifests declare a `sha256` for each weight file; downloads are verified.
- The roadmap specifies converting pickle-based checkpoints to `safetensors` at
  install time (safetensors cannot execute code on load).
- Model contribution PRs must carry an accurate `license.spdx` (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md)) and, where the manifest re-hosts weights,
  a documented, checkable source — manifests pointing at unverifiable or
  unofficial mirrors will not be merged.
- Only install models from sources you trust, exactly as you would any dependency.

If you find a way to make Neiro execute unexpected code from an audio file, a
manifest, a downloaded model weight, or a rendered UI page, that is in scope and
we want to hear about it.

## Browser threat model (local API)

The API binds to `127.0.0.1`, but loopback does not stop a malicious web page from
sending *simple* cross-site requests, nor does it stop DNS rebinding. Since 1.2.x the
server enforces, in `src/neiro/ui/security.py`:

- **Host must be loopback** (`127.0.0.1`, `localhost`, `[::1]`) on any port. A
  non-loopback `Host` is rejected with 403, which closes DNS rebinding.
- **Origin allowlist**: loopback origins (including the Vite dev proxy),
  `chrome-extension://` / `moz-extension://` (the optional companion), or explicit
  `NEIRO_EXTRA_ORIGINS` entries. `null` and unknown origins are rejected; CORS is
  echoed only for allowed origins and never uses `*`.
- **Per-process token** (`X-Neiro-Token`) on every mutation. The token is issued to
  the same-origin UI at `GET /api/auth/token` and refused for cross-site fetches.
  The native DAW bridge (`/api/daw/*`) is exempt because its content types are not
  CORS-safelisted and cannot be forged by a cross-site form.
- **JSON content type required**: a `text/plain` body of JSON is rejected with 415
  instead of being parsed (this was the browser-CSRF hole).
- **Body and upload caps** (1 MiB JSON, 128 MiB upload by default, configurable via
  `NEIRO_MAX_UPLOAD_MB`) plus a free-space preflight (507 when the disk is low).
- **Explicit consent** for plugin grants and tool installs (`{"confirm": true}`).
- **Pairing** for the companion: a short-lived 6-digit code, exchanged at
  `POST /api/pair` for the API token and rotated after use.
- **URL ingest policy**: HTTP(S) only, no credentials, private/loopback hosts
  rejected. This is a policy guard, not a complete SSRF defence: a redirecting
  downloader or DNS rebinding can still reach a private address, so ingest remains
  an opt-in feature.

Path-traversal checks for `/files/` and upload names are unchanged and covered by
tests. Report vulnerabilities privately as described above.
