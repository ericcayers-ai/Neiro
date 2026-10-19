"""Browser-threat policy for the local Neiro HTTP API.

The API is loopback-only, but loopback does not stop a malicious page from sending
*simple* cross-site requests, and it does not stop DNS rebinding. This module keeps
the policy in one place so the handler stays readable and the tests can drive it
directly.

Rules enforced by :class:`SecurityPolicy`:

* ``Host`` must be a loopback name (``127.0.0.1``, ``localhost``, ``[::1]``) with any
  port. Rejecting non-loopback hosts kills DNS rebinding even when the socket is
  bound to ``127.0.0.1``.
* A present ``Origin`` must be loopback (any port, so the Vite dev proxy works),
  ``chrome-extension://`` (the optional companion), or an explicit
  ``NEIRO_EXTRA_ORIGINS`` entry. ``null`` and unknown origins are rejected.
* Every mutation needs ``X-Neiro-Token`` matching the per-process token, except the
  native DAW bridge routes, which are protected by non-simple content types plus the
  Host/Origin checks and cannot be driven by a cross-site form.
* JSON requests must declare ``application/json``; a ``text/plain`` body of JSON is
  refused with 415 instead of being parsed (that was the CSRF hole).
* Bodies are capped (JSON and uploads) and uploads get a free-space preflight.

No wildcard CORS is ever emitted.
"""

from __future__ import annotations

import hmac
import ipaddress
import os
import re
import secrets
from dataclasses import dataclass, field
from urllib.parse import urlsplit

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

MAX_JSON_BYTES = 1 * 1024 * 1024
DEFAULT_MAX_UPLOAD_BYTES = 128 * 1024 * 1024
UPLOAD_RESERVE_BYTES = 512 * 1024 * 1024

#: Mutations the native VST/CLAP bridge performs. They still require a loopback
#: Host, an allowlisted (or absent) Origin, and a non-simple content type.
NATIVE_BRIDGE_PREFIXES = ("/api/daw/",)

#: Routes that establish trust, so they cannot require the token they issue.
PUBLIC_MUTATIONS = ("/api/pair",)


class RequestRejected(Exception):
    """A request the policy refuses; the handler turns this into an HTTP error."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _split_host(value: str) -> str:
    """Return the hostname from a Host header (IPv6 brackets preserved as ``::1``)."""
    value = (value or "").strip().lower()
    if not value:
        return ""
    if value.startswith("["):
        end = value.find("]")
        return value[1:end] if end > 0 else value
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def host_allowed(host_header: str) -> bool:
    return _split_host(host_header) in LOOPBACK_HOSTS


def _origin_host(origin: str) -> str:
    try:
        return (urlsplit(origin).hostname or "").lower()
    except ValueError:
        return ""


def origin_allowed(origin: str | None, extra_origins: set[str] | None = None) -> bool:
    if not origin:
        return True  # non-browser client (CLI, VST, native test)
    origin = origin.strip()
    if origin.lower() == "null":
        return False
    if origin.startswith("chrome-extension://") or origin.startswith("moz-extension://"):
        return True  # the companion must present the pairing token anyway
    if _origin_host(origin) in LOOPBACK_HOSTS:
        return True
    return origin.rstrip("/") in (extra_origins or set())


@dataclass
class SecurityPolicy:
    token: str = field(
        default_factory=lambda: os.environ.get("NEIRO_API_TOKEN") or secrets.token_urlsafe(24)
    )
    max_json_bytes: int = MAX_JSON_BYTES
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES
    extra_origins: set[str] = field(default_factory=set)
    require_token: bool = True

    def __post_init__(self) -> None:
        raw = os.environ.get("NEIRO_EXTRA_ORIGINS", "")
        for item in raw.split(","):
            item = item.strip().rstrip("/")
            if item:
                self.extra_origins.add(item)
        try:
            configured = int(os.environ.get("NEIRO_MAX_UPLOAD_MB", "0") or 0)
        except ValueError:
            configured = 0
        if configured > 0:
            self.max_upload_bytes = configured * 1024 * 1024

    # -- individual rules --------------------------------------------------
    def check_host(self, host_header: str) -> None:
        if not host_allowed(host_header):
            raise RequestRejected(403, "host not allowed (loopback only)")

    def check_origin(self, origin: str | None) -> None:
        if not origin_allowed(origin, self.extra_origins):
            raise RequestRejected(403, "origin not allowed")

    def check_token(self, presented: str | None) -> None:
        if not self.require_token:
            return
        if not presented or not hmac.compare_digest(presented, self.token):
            raise RequestRejected(401, "missing or invalid X-Neiro-Token")

    def is_native_bridge(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in NATIVE_BRIDGE_PREFIXES)

    def is_public_mutation(self, path: str) -> bool:
        return path in PUBLIC_MUTATIONS

    def cors_headers(self, origin: str | None) -> dict[str, str]:
        """Return CORS response headers for an allowlisted origin, never ``*``."""
        if not origin or not origin_allowed(origin, self.extra_origins):
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Neiro-Token, X-Filename, X-Instance-Id, X-Module",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }


def _ip_is_public(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return True
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


_PRIVATE_NAME = re.compile(
    r"(^localhost$|\.localhost$|\.local$|\.internal$|^metadata\.google\.internal$)",
    re.IGNORECASE,
)


def check_outbound_url(url: str) -> str:
    """Validate a user-supplied URL before any downloader sees it.

    This is a policy check, not a complete SSRF defence: DNS names can resolve to a
    private address, and a downloader that follows redirects can be redirected
    inward. It blocks the obvious direct targets and non-HTTP schemes; the URL
    ingest feature remains opt-in and is documented as such.
    """
    parsed = urlsplit((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise RequestRejected(400, "url must start with http:// or https://")
    if parsed.username or parsed.password:
        raise RequestRejected(400, "url must not contain credentials")
    host = (parsed.hostname or "").lower()
    if not host:
        raise RequestRejected(400, "url has no host")
    if _PRIVATE_NAME.search(host):
        raise RequestRejected(400, "url host is not allowed (private/loopback)")
    literal = host.strip("[]")
    if not _ip_is_public(literal) and _is_ip_literal(literal):
        raise RequestRejected(400, "url host is not allowed (private/loopback)")
    return url.strip()


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True
