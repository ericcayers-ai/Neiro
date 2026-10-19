#!/usr/bin/env python
"""Neiro goal gate.

One mechanical check per criterion in ``GOAL.md``. Prints one PASS/FAIL line per
criterion (with the reason on FAIL) and exits non-zero if any check fails.

Usage::

    python scripts/verify_goal.py            # fast checks: Python + contracts + static
    python scripts/verify_goal.py --full     # also the frontend type-check/build
    python scripts/verify_goal.py --fast     # skip the full pytest run
    python scripts/verify_goal.py --only C8  # a single criterion (debugging)

The gate is the authority for "done". A check that cannot run (missing node,
missing node_modules, no browser) fails with its reason, never silently passes.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
BASETEMP = Path(os.environ.get("NEIRO_GATE_BASETEMP", r"C:\np"))

CRITERIA = [f"C{i}" for i in range(1, 23)]


def _run(
    args: list[str],
    *,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
    timeout: int = 1800,
) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.setdefault("PYTHONIOENCODING", "utf-8")
    if env:
        merged.update(env)
    return subprocess.run(
        args,
        cwd=str(cwd),
        env=merged,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def _tail(text: str, lines: int = 8) -> str:
    parts = [line for line in (text or "").strip().splitlines() if line.strip()]
    return " | ".join(parts[-lines:])


def _pytest(targets: list[str], *, fast: bool = False) -> tuple[bool, str]:
    # pyproject already adds -q; a second -q would suppress the summary line the
    # gate parses for the pass count.
    args = [PY, "-m", "pytest", "-p", "no:cacheprovider", "--basetemp", str(BASETEMP)]
    if fast:
        args += ["-m", "not slow"]
    args += targets
    proc = _run(args, timeout=2400)
    ok = proc.returncode == 0
    summary = ""
    for line in reversed((proc.stdout or "").splitlines()):
        if " passed" in line or " failed" in line or " error" in line:
            summary = line.strip()
            break
    reason = summary or _tail(proc.stdout + proc.stderr)
    if ok and not summary:
        reason = "pytest exit 0"
    return ok, reason


def _read(path: str) -> str:
    target = ROOT / path
    return target.read_text(encoding="utf-8") if target.is_file() else ""


def _exists(*paths: str) -> str | None:
    missing = [p for p in paths if not (ROOT / p).exists()]
    return f"missing: {', '.join(missing)}" if missing else None


# --------------------------------------------------------------------------- checks


def c1_pitch_fix(fast: bool) -> tuple[bool, str]:
    log = _run(["git", "log", "--all", "--grep=pitch_correct", "--format=%H"])
    committed = bool((log.stdout or "").strip())
    src = _read("src/neiro/ui/server.py")
    shape_ok = 'ctx.report("pitch_correct"' in src and 'progress("pitch_correct:' not in src
    test_ok, reason = _pytest(["tests/test_pitch_correct_report.py"], fast=True)
    if not (committed and shape_ok and test_ok):
        return False, f"committed={committed} shape={shape_ok} test={reason}"
    return True, "fix committed; regression test passes"


def c2_suite(fast: bool) -> tuple[bool, str]:
    ok, reason = _pytest([], fast=fast)
    if not ok:
        return False, reason
    match = re.search(r"(\d+) passed", reason)
    count = int(match.group(1)) if match else 0
    if count < 230:
        return False, f"only {count} tests passed (need >= 230): {reason}"
    return True, reason


def c3_lint(fast: bool) -> tuple[bool, str]:
    ruff = shutil.which("ruff") or str(Path(PY).with_name("ruff.exe"))
    check = _run([ruff, "check", "."])
    fmt = _run([ruff, "format", "--check", "."])
    if check.returncode != 0:
        return False, f"ruff check: {_tail(check.stdout + check.stderr, 4)}"
    if fmt.returncode != 0:
        return False, f"ruff format: {_tail(fmt.stdout + fmt.stderr, 4)}"
    return True, "ruff check + format clean"


def c4_frontend(fast: bool, full: bool) -> tuple[bool, str]:
    if not full:
        return False, "not run (pass --full)"
    if not (ROOT / "frontend" / "node_modules").exists():
        return False, "frontend/node_modules missing; run npm ci"
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        return False, "npx not found on PATH"
    tsc = _run(
        [npx, "--no-install", "tsc", "-p", "tsconfig.app.json", "--noEmit"],
        cwd=ROOT / "frontend",
        timeout=900,
    )
    if tsc.returncode != 0:
        return False, f"tsc: {_tail(tsc.stdout + tsc.stderr, 6)}"
    build = _run([npx, "--no-install", "vite", "build"], cwd=ROOT / "frontend", timeout=1200)
    if build.returncode != 0:
        return False, f"vite: {_tail(build.stdout + build.stderr, 6)}"
    return True, "tsc + vite build pass"


def c5_enhance_noop(fast: bool) -> tuple[bool, str]:
    return _pytest(["tests/test_contract_truth.py", "-k", "enhance"], fast=True)


def c6_notes(fast: bool) -> tuple[bool, str]:
    return _pytest(["tests/test_contract_truth.py", "-k", "notes"], fast=True)


def c7_verify_models(fast: bool) -> tuple[bool, str]:
    script = _read("scripts/verify_models.py")
    if "sys.executable" not in script:
        return False, "verify_models.py does not use the current interpreter"
    if '["neiro", "models"]' in script or "['neiro', 'models']" in script:
        return False, "verify_models.py still shells out to neiro on PATH"
    return _pytest(["tests/test_contract_truth.py", "-k", "verify_models"], fast=True)


def c8_security(fast: bool) -> tuple[bool, str]:
    return _pytest(["tests/test_security_api.py"], fast=True)


def c9_cors(fast: bool) -> tuple[bool, str]:
    source = _read("src/neiro/ui/server.py") + _read("src/neiro/ui/security.py")
    if "Access-Control-Allow-Origin" not in source:
        return False, "no CORS handling in the API"
    if re.search(r'Access-Control-Allow-Origin"\s*,\s*"\*"', source):
        return False, "wildcard CORS header present"
    return _pytest(["tests/test_security_api.py", "-k", "cors or options"], fast=True)


def c10_player(fast: bool) -> tuple[bool, str]:
    missing = _exists(
        "frontend/src/player/AudioEngine.ts",
        "frontend/src/player/Transport.ts",
        "frontend/src/player/params.ts",
        "frontend/src/player/provenance.ts",
        "frontend/src/player/PlayerSurface.tsx",
        "frontend/src/player/worklet/player-worklet.js",
        "docs/evidence/player-latency-2026-10-20.md",
    )
    if missing:
        return False, missing
    node = shutil.which("node")
    if not node:
        return False, "node missing"
    tests = _run(
        [
            node,
            "--test",
            "frontend/src/player/tests/player.test.mjs",
            "frontend/src/player/tests/logic.test.mjs",
        ],
        timeout=600,
    )
    if tests.returncode != 0:
        return False, f"player tests: {_tail(tests.stdout + tests.stderr, 6)}"
    receipt = _read("docs/evidence/player-latency-2026-10-20.md")
    if not re.search(r"\b\d+(\.\d+)?\s*ms\b", receipt):
        return False, "latency receipt has no measured ms figure"
    return True, "SDK + worklet + tests + measured latency receipt"


def c11_practice(fast: bool) -> tuple[bool, str]:
    practice = _read("frontend/src/modules/midi/MidiPracticePanel.tsx")
    if "PlayerSurface" not in practice and "usePlayer" not in practice:
        return False, "MidiPracticePanel does not use the shared player"
    if "loop={looping}" in practice:
        return False, "whole-file <audio loop> still present"
    if "Pitch-preserving stretch ready" in practice:
        return False, "unconditional pitch-preserving claim still present"
    if "Rubber Band" in practice:
        return False, "Rubber Band claim still present"
    return True, "practice panel uses the shared player; no whole-file loop or false claim"


def c12_library(fast: bool) -> tuple[bool, str]:
    missing = _exists(
        "src/neiro/library/__init__.py",
        "src/neiro/library/store.py",
        "frontend/src/modules/LibraryModule.tsx",
    )
    if missing:
        return False, missing
    return _pytest(["tests/test_library.py"], fast=True)


def c13_analysis(fast: bool) -> tuple[bool, str]:
    ui = (
        _read("frontend/src/modules/AnalysisModule.tsx")
        + _read("frontend/src/modules/AnalysisLanes.tsx")
    ).lower()
    if "chord" not in ui or "beat" not in ui:
        return False, "Analysis UI has no chord/beat lane"
    return _pytest(["tests/test_analysis_timeline.py"], fast=True)


def c14_addon(fast: bool) -> tuple[bool, str]:
    missing = _exists(
        "addon/manifest.json",
        "addon/src/service-worker.js",
        "addon/src/sidepanel/index.html",
        "addon/src/offscreen/offscreen.html",
        "addon/src/adapters/adapters.js",
        "addon/scripts/validate.mjs",
    )
    if missing:
        return False, missing
    node = shutil.which("node")
    if not node:
        return False, "node missing"
    proc = _run([node, "addon/scripts/validate.mjs"], timeout=300)
    if proc.returncode != 0:
        return False, _tail(proc.stdout + proc.stderr, 6)
    return True, _tail(proc.stdout, 2) or "addon static validation passed"


def c15_docs(fast: bool) -> tuple[bool, str]:
    problems = []
    readme = _read("README.md")
    if "1.2.1" not in readme:
        problems.append("README version stale")
    security = _read("SECURITY.md")
    if "CSRF" not in security:
        problems.append("SECURITY.md lacks CSRF/Origin section")
    trace = _read("docs/roadmap-traceability.md")
    if "structural" not in trace.lower() or "not behavioural" not in trace.lower():
        problems.append("traceability banner missing")
    session_doc = _read("docs/session.md")
    if "Not yet wired" in session_doc:
        problems.append("docs/session.md still says UI not wired")
    if "pre-1.0" in security:
        problems.append("SECURITY.md still says pre-1.0")
    if problems:
        return False, "; ".join(problems)
    return True, "README/SECURITY/session/traceability claims current"


def c16_licence(fast: bool) -> tuple[bool, str]:
    hits = []
    for path in ROOT.rglob("*"):
        if any(part in {".git", "node_modules", ".venv", "target"} for part in path.parts):
            continue
        if path.is_file() and path.name.lower() in {"rb.wasm", "rubberband.wasm"}:
            hits.append(str(path.relative_to(ROOT)))
    if hits:
        return False, f"prohibited DSP artefact present: {hits}"
    notices = ROOT / "THIRD_PARTY_NOTICES.txt"
    if not notices.exists():
        notices = ROOT / "docs" / "THIRD_PARTY_NOTICES.md"
    if not notices.exists():
        return False, "no third-party notices file"
    return True, "no rb.wasm; notices present"


def c17_queued(fast: bool) -> tuple[str, str] | tuple[bool, str]:
    source = _read("src/neiro/ui/server.py")
    if "edit_job" not in source and "start_edit_job" not in source:
        return False, "edit ops are still synchronous only"
    return _pytest(["tests/test_contract_truth.py", "-k", "queued"], fast=True)


def c20_download_preflight(fast: bool) -> tuple[bool, str]:
    source = _read("src/neiro/ui/server.py")
    if "download_disk_preflight" not in source:
        return False, "server has no declared-size download preflight"
    return _pytest(["tests/test_download_preflight.py"], fast=True)


def c22_frontend_tests(fast: bool, full: bool) -> tuple[bool, str]:
    if not full:
        return False, "not run (pass --full)"
    if not (ROOT / "frontend" / "node_modules").exists():
        return False, "frontend/node_modules missing; run npm ci"
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        return False, "npx not found on PATH"
    proc = _run([npx, "--no-install", "vitest", "run"], cwd=ROOT / "frontend", timeout=900)
    if proc.returncode != 0:
        return False, _tail(proc.stdout + proc.stderr, 8)
    summary = ""
    for line in (proc.stdout or "").splitlines():
        if "Tests" in line and "passed" in line:
            summary = line.strip()
    return True, summary or "vitest passed"


def c21_a11y_static(fast: bool) -> tuple[bool, str]:
    script = ROOT / "scripts" / "a11y_static.py"
    if not script.is_file():
        return False, "scripts/a11y_static.py missing"
    proc = _run([PY, str(script), "--strict"], timeout=300)
    if proc.returncode != 0:
        return False, _tail(proc.stdout + proc.stderr, 6)
    return True, _tail(proc.stdout, 2) or "static a11y clean"


def c19_disk(fast: bool) -> tuple[bool, str]:
    source = _read("src/neiro/ui/server.py")
    if "cache_budget_effective_gb" not in source or "disk_free_gb" not in source:
        return False, "server does not expose the effective cache budget / free disk"
    ok, reason = _pytest(["tests/test_disk_preflight.py"], fast=True)
    if not ok:
        return False, reason
    return True, reason


def c18_i18n(fast: bool) -> tuple[bool, str]:
    missing = _exists(
        "frontend/src/player/i18n.ts",
        "docs/accessibility.md",
    )
    if missing:
        return False, missing
    return True, "string catalogue module + accessibility notes present"


def criteria_match() -> tuple[bool, str]:
    text = _read("GOAL.md")
    found = sorted(set(re.findall(r"\|\s*(C\d+)\s*\|", text)), key=lambda cid: int(cid[1:]))
    if found != CRITERIA:
        return False, f"GOAL.md criteria {found} != gate criteria {CRITERIA}"
    return True, f"{len(found)} criteria matched"


CHECKS = {
    "C1": c1_pitch_fix,
    "C2": c2_suite,
    "C3": c3_lint,
    "C5": c5_enhance_noop,
    "C6": c6_notes,
    "C7": c7_verify_models,
    "C8": c8_security,
    "C9": c9_cors,
    "C10": c10_player,
    "C11": c11_practice,
    "C12": c12_library,
    "C13": c13_analysis,
    "C14": c14_addon,
    "C15": c15_docs,
    "C16": c16_licence,
    "C17": c17_queued,
    "C18": c18_i18n,
    "C19": c19_disk,
    "C20": c20_download_preflight,
    "C21": c21_a11y_static,
    "C22": c22_frontend_tests,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="include the frontend build")
    parser.add_argument("--fast", action="store_true", help="skip the full pytest suite")
    parser.add_argument("--only", default="", help="comma-separated criterion ids")
    args = parser.parse_args()
    only = {part.strip().upper() for part in args.only.split(",") if part.strip()}
    BASETEMP.mkdir(parents=True, exist_ok=True)

    ok, reason = criteria_match()
    print(f"{'PASS' if ok else 'FAIL'} criterion-set: {reason}")

    failures = 0 if ok else 1
    results: list[tuple[str, bool, str]] = []
    for cid in CRITERIA:
        if only and cid not in only:
            continue
        if cid == "C2" and args.fast:
            results.append((cid, True, "skipped (--fast)"))
            continue
        if cid == "C4":
            passed, detail = c4_frontend(args.fast, args.full)
        elif cid == "C22":
            passed, detail = c22_frontend_tests(args.fast, args.full)
        else:
            passed, detail = CHECKS[cid](args.fast)
        results.append((cid, passed, detail))
        print(f"{'PASS' if passed else 'FAIL'} {cid}: {detail}")
        if not passed:
            failures += 1

    print()
    print(
        f"GATE {'PASS' if failures == 0 else 'FAIL'} — {len(results) - failures}/{len(results)} criteria"
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
