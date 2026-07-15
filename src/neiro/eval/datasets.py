"""User-provisioned reference dataset locators (roadmap §12).

Full separation/transcription benchmarking against MUSDB18-HQ, MoisesDB,
Slakh2100, GuitarSet, ENST/ADTOF, and MAESTRO needs their real, licensed audio —
multiple gigabytes each, not something this repository ships or downloads on
your behalf. Locating them is entirely environment-variable driven; every
runner in ``scripts/eval/`` uses these locators and **skips with a clear,
actionable message** (exit 0, not a failure) when a dataset isn't configured,
so CI never depends on data nobody has agreed to download.

See ``docs/evaluation.md`` for how to obtain each dataset and point Neiro at it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "DatasetStatus",
    "MUSDB_ENV",
    "MAESTRO_ENV",
    "locate_musdb",
    "locate_maestro",
    "locate",
]

MUSDB_ENV = "NEIRO_EVAL_MUSDB"
MAESTRO_ENV = "NEIRO_EVAL_MAESTRO"


@dataclass
class DatasetStatus:
    """Whether a user-provisioned dataset is usable, and why/why not."""

    available: bool
    path: Path | None
    message: str

    def as_dict(self) -> dict[str, object]:
        return {
            "available": self.available,
            "path": str(self.path) if self.path else None,
            "message": self.message,
        }


def _locate(env_var: str, dataset_label: str, expect_subdirs: tuple[str, ...] = ()) -> DatasetStatus:
    raw = os.environ.get(env_var)
    if not raw:
        return DatasetStatus(
            available=False,
            path=None,
            message=(
                f"{env_var} is not set — skipping {dataset_label} evaluation. "
                f"Set it to a local {dataset_label} directory to enable this run; "
                "see docs/evaluation.md for how to obtain the dataset."
            ),
        )
    path = Path(raw).expanduser()
    if not path.is_dir():
        return DatasetStatus(
            available=False,
            path=path,
            message=(
                f"{env_var}={raw!r} does not exist or is not a directory — "
                f"skipping {dataset_label} evaluation."
            ),
        )
    missing = [d for d in expect_subdirs if not (path / d).exists()]
    if missing:
        return DatasetStatus(
            available=False,
            path=path,
            message=(
                f"{env_var}={raw!r} exists but doesn't look like a {dataset_label} root "
                f"(missing: {', '.join(missing)}) — skipping {dataset_label} evaluation."
            ),
        )
    return DatasetStatus(available=True, path=path, message=f"using {dataset_label} at {path}")


def locate_musdb() -> DatasetStatus:
    """Locate a MUSDB18-HQ root via ``NEIRO_EVAL_MUSDB``.

    Expects the standard decoded MUSDB18-HQ layout: ``<root>/train/`` and
    ``<root>/test/``, each containing one folder per track with
    ``mixture.wav`` and per-stem ``.wav`` files.
    """
    return _locate(MUSDB_ENV, "MUSDB18-HQ", expect_subdirs=("train", "test"))


def locate_maestro() -> DatasetStatus:
    """Locate a MAESTRO root via ``NEIRO_EVAL_MAESTRO``.

    Expects a MAESTRO v2/v3-style layout: a root directory containing a
    ``maestro-v*.csv`` metadata file alongside year-numbered audio/MIDI folders.
    Only the root directory's existence is checked here; the runner validates
    the metadata CSV itself so the error message can point at the exact file.
    """
    return _locate(MAESTRO_ENV, "MAESTRO", expect_subdirs=())


def locate(name: str) -> DatasetStatus:
    """Dispatch by dataset name — convenience for generic reporting/CLI code."""
    dispatch = {"musdb": locate_musdb, "musdb18hq": locate_musdb, "maestro": locate_maestro}
    key = name.strip().lower()
    if key not in dispatch:
        raise ValueError(f"unknown dataset {name!r}; expected one of {sorted(set(dispatch))}")
    return dispatch[key]()
