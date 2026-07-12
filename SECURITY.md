# Security Policy

## Supported versions

Neiro is pre-1.0; security fixes land on `main` and in the next tagged release.
The latest release is the only supported version.

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on the repository) or email
**eric.c.ayers@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce, and
- affected version(s).

You can expect an acknowledgement within a few days and a fix or mitigation plan
once the report is confirmed. Please give a reasonable window to address the
issue before any public disclosure.

## Security model & scope

Neiro is a **local-first** application. Its design keeps the attack surface small:

- **No network egress by default.** The engine processes audio locally and does
  not transmit audio anywhere. The only outbound network activity is *explicit,
  user-initiated* model downloads and application updates.
- **The interface binds to `127.0.0.1` only.** The `neiro ui` server is not
  exposed to the local network or the internet. File serving is confined to a
  per-session temporary workspace, and paths are resolved and checked against
  that workspace root to prevent traversal (regression-tested).
- **No secrets, tokens, or credentials** are stored or required by the core.

### What we consider in scope

- Path traversal or workspace escape in the local UI server.
- Crashes or resource exhaustion triggered by crafted **audio** input (the parser
  is expected to reject or degrade gracefully, never execute).
- Any code path that would cause audio or user data to leave the machine
  unexpectedly.

### Model weights: a supply-chain note

Neiro loads third-party model weights through manifests. Weights are **code-like
artifacts** — a malicious checkpoint can be dangerous. Mitigations in place and
planned:

- Manifests declare a `sha256` for each weight file; downloads are verified.
- The roadmap specifies converting pickle-based checkpoints to `safetensors` at
  install time (safetensors cannot execute code on load).
- Only install models from sources you trust, exactly as you would any dependency.

If you find a way to make Neiro execute unexpected code from an audio file or a
manifest, that is in scope and we want to hear about it.
