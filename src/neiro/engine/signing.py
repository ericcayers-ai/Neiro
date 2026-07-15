"""Minimal signed model index verification (roadmap §10.2)."""

from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from typing import Any


def canonical_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sign_index(payload: dict[str, Any], secret: bytes) -> str:
    return hmac.new(secret, canonical_bytes(payload), hashlib.sha256).hexdigest()


def verify_index(payload: dict[str, Any], signature: str, secret: bytes) -> bool:
    expected = sign_index(payload, secret)
    return hmac.compare_digest(expected, signature)


def load_signed_index(path: Path, secret: bytes | None = None) -> dict[str, Any]:
    """Load a registry index JSON; verify HMAC if ``signature`` + secret present."""
    data = json.loads(path.read_text(encoding="utf-8"))
    sig = data.pop("signature", None)
    if secret is not None and sig:
        if not verify_index(data, sig, secret):
            raise ValueError(f"signed index verification failed for {path}")
    elif sig and secret is None:
        # Signature present but no secret configured — surface honesty note
        data.setdefault("_verification", "signature present but no secret configured; not verified")
    else:
        data.setdefault("_verification", "unsigned")
    return data


def write_signed_index(path: Path, payload: dict[str, Any], secret: bytes) -> None:
    body = dict(payload)
    body.pop("signature", None)
    sig = sign_index(body, secret)
    out = dict(body)
    out["signature"] = sig
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
