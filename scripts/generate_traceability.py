"""Seed docs/roadmap-traceability.md from roadmap.md normative items."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
roadmap = (ROOT / "roadmap.md").read_text(encoding="utf-8")
lines = roadmap.splitlines()
reqs: list[tuple[str, str, str, str]] = []
section = "P0"
subsection = ""
rid = 0


def add(kind: str, text: str, sec: str) -> None:
    global rid
    rid += 1
    text = re.sub(r"\s+", " ", text).strip(" -*")
    if len(text) < 8:
        return
    reqs.append((f"R-{rid:04d}", kind, sec, text[:240]))


for line in lines:
    if line.startswith("## "):
        section = line[3:].strip()
        subsection = ""
    elif line.startswith("### "):
        subsection = line[4:].strip()
    sec = f"{section}" + (f" / {subsection}" if subsection else "")
    s = line.strip()
    if s.startswith("- ") and "http" not in s[:30]:
        add("bullet", s[2:], sec)
    elif re.match(r"^\d+\.\s+\*\*", s):
        add("principle", s, sec)
    elif s.startswith("|") and "---" not in s and s.count("|") >= 3:
        cells = [c.strip() for c in s.strip("|").split("|")]
        joined = " / ".join(c for c in cells if c)
        if any(
            k in joined
            for k in ("Deferred", "Partial", "Not met", "Complete", "Shipped", "Met", "M0", "M1")
        ):
            add("ledger", joined, sec)

for m in ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"]:
    add(
        "milestone",
        f"Milestone {m} exit criteria from roadmap section 13 must be met for 1.0.",
        "Delivery Milestones",
    )

for text in (
    "Model licensing surfaced in UI and export metadata",
    "VRAM downgrade ladder never OOMs the user",
    "DirectML/ONNX path for non-NVIDIA Windows",
    "Default cache paths avoid cloud-synced folders",
    "Perf CI green",
    "A11y audit clean WCAG 2.2 AA",
    "Golden corpus stable",
    "No unexplained test skips",
    "Cross-platform bundle installers",
    "Session provenance and pinning",
):
    add("gate", text, "Phase 10 / M7")

header = """# Roadmap traceability matrix

Source of truth: `roadmap.md`. Every normative item below must link to
implementation, tests, docs, and verification evidence before 1.0 acceptance.
Status values: `open` | `partial` | `verified`.

| ID | Kind | Section | Requirement | Implementation | Tests | Docs | Status |
|---|---|---|---|---|---|---|---|
"""

rows = []
for req_id, kind, sec, text in reqs:
    text = text.replace("|", "/")
    sec = sec.replace("|", "/")[:48]
    rows.append(f"| {req_id} | {kind} | {sec} | {text} | — | — | — | open |")

out = ROOT / "docs" / "roadmap-traceability.md"
out.write_text(header + "\n".join(rows) + "\n", encoding="utf-8")
print(f"Wrote {len(reqs)} requirements to {out}")
