#!/usr/bin/env python
"""Static accessibility checks for the React UI.

This is a *static* audit, not axe/WCAG: it catches high-confidence mistakes that
are cheap to detect without a browser (missing image alternatives, empty buttons
without names, missing document language, empty aria labels). It reports what it
finds and exits 0 by default; ``--strict`` fails on findings for CI adoption once
the baseline is clean.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"

IMG = re.compile(r"<img\b[^>]*>", re.IGNORECASE | re.DOTALL)
EMPTY_BUTTON = re.compile(r"<button\b[^>]*>\s*</button>", re.IGNORECASE | re.DOTALL)
EMPTY_ARIA = re.compile(r'aria-label\s*=\s*["\']\s*["\']', re.IGNORECASE)
HTML_TAG = re.compile(r"<html\b[^>]*>", re.IGNORECASE)


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def scan() -> tuple[int, list[str], list[str]]:
    files = sorted(SRC.rglob("*.tsx")) + sorted(SRC.rglob("*.html"))
    findings: list[str] = []
    warnings: list[str] = []
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in IMG.finditer(text):
            tag = match.group(0)
            if not re.search(r"\balt\s*=", tag, re.IGNORECASE):
                findings.append(f"{rel}:{_line_of(text, match.start())}: <img> without alt")
        for match in EMPTY_BUTTON.finditer(text):
            tag = match.group(0)
            if not re.search(r"aria-label|title|aria-labelledby", tag, re.IGNORECASE):
                findings.append(
                    f"{rel}:{_line_of(text, match.start())}: empty <button> without an accessible name"
                )
        for match in EMPTY_ARIA.finditer(text):
            findings.append(f"{rel}:{_line_of(text, match.start())}: empty aria-label")
        if path.suffix == ".html":
            match = HTML_TAG.search(text)
            if match and not re.search(r"\blang\s*=", match.group(0), re.IGNORECASE):
                findings.append(f"{rel}:1: <html> without lang")
        if "<audio" in text and "aria-label" not in text:
            warnings.append(
                f"{rel}: <audio> element without an aria-label (check the surrounding control)"
            )
        for match in re.finditer(
            r"<(div|span|li)\b[^>]*\bonClick[^>]*>", text, re.IGNORECASE | re.DOTALL
        ):
            tag = match.group(0)
            if re.search(r"\brole\s*=|\btabIndex", tag, re.IGNORECASE):
                continue
            warnings.append(
                f"{rel}:{_line_of(text, match.start())}: click handler on a non-interactive element "
                "(add role + keyboard support or use a button)"
            )
    return len(files), findings, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="exit 1 when findings exist")
    args = parser.parse_args()
    count, findings, warnings = scan()
    print(f"Scanned {count} UI files")
    for item in findings:
        print(f"FINDING {item}")
    for item in warnings:
        print(f"WARN {item}")
    print(f"\nStatic a11y: {len(findings)} finding(s), {len(warnings)} warning(s)")
    if args.strict and findings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
