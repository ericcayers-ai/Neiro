#!/usr/bin/env python
"""Smoke/skip runners for MoisesDB, Slakh2100, GuitarSet, and ENST/ADTOF.

These corpora are multi-gigabyte and separately licensed. When the matching
``NEIRO_EVAL_*`` env var is unset, this exits **0** with an actionable message
(same contract as ``run_musdb.py`` / ``run_maestro.py``). When set, it validates
the root looks usable and prints a JSON readiness report — full scoring against
each layout is done by extending this runner once a provisioned machine has the
data; the harness contract (locate + skip + measure-ready) is what gates 1.0.
"""

from __future__ import annotations

import argparse
import json
import sys

from neiro.eval.datasets import (
    locate_enst,
    locate_guitarset,
    locate_moises,
    locate_slakh,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print JSON status for all corpora")
    args = parser.parse_args()
    statuses = {
        "moises": locate_moises(),
        "slakh": locate_slakh(),
        "guitarset": locate_guitarset(),
        "enst": locate_enst(),
    }
    payload = {name: s.as_dict() for name, s in statuses.items()}
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        for name, status in statuses.items():
            mark = "ready" if status.available else "skip"
            print(f"[{mark}] {name}: {status.message}")
    # Always exit 0 — absence of licensed corpora must not fail CI.
    return 0


if __name__ == "__main__":
    sys.exit(main())
