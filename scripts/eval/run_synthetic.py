#!/usr/bin/env python
"""Run the synthetic golden-corpus evaluation suite. Always runs — no external
datasets, no downloads, no GPU. This is the runner behind the "synthetic
goldens that always run in CI" requirement (roadmap §12); see
``docs/evaluation.md``.

Usage:
    python scripts/eval/run_synthetic.py                 # human-readable table
    python scripts/eval/run_synthetic.py --json report.json
    python scripts/eval/run_synthetic.py --json -         # JSON to stdout

Exit code is 1 if any suite fails its threshold, 0 otherwise — safe to wire
into CI as a blocking step.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from neiro.eval.report import run_synthetic_suite


def _print_table(report: dict) -> None:
    for suite in report["suites"]:
        status = "PASS" if suite["passed"] else "FAIL"
        print(f"\n=== {suite['name']} [{status}] ===")
        for case in suite["cases"]:
            case_status = "ok" if case["passed"] else "FAIL"
            details = ", ".join(
                f"{k}={v}" for k, v in case.items() if k not in ("case", "description", "passed")
            )
            print(f"  [{case_status}] {case['case']}: {details}")
    overall = "PASS" if report["passed"] else "FAIL"
    print(f"\nOverall: {overall}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        metavar="PATH",
        default=None,
        help="write the report as JSON to PATH ('-' for stdout) in addition to the table",
    )
    args = parser.parse_args(argv)

    report = run_synthetic_suite()
    _print_table(report)

    if args.json:
        payload = json.dumps(report, indent=2)
        if args.json == "-":
            print(payload)
        else:
            Path(args.json).write_text(payload, encoding="utf-8")
            print(f"\nWrote {args.json}")

    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
