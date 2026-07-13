"""Frozen-app entry point.

With no arguments, launches the local UI (the friendliest default for a
double-clicked executable); with arguments, behaves exactly like the ``neiro``
CLI. This lets one built executable serve both the "one-click UI" and
"one-click CLI" launchers in the release bundle.
"""

import sys


def main() -> int:
    from neiro.cli import main as cli_main

    argv = sys.argv[1:]
    if not argv:
        # Double-clicked / no args: open the interface.
        argv = ["ui"]
    return cli_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
