"""Full model compatibility verification for Neiro manifests and presets.

Usage:
    python scripts/verify_models.py           # structural + DSP smoke (no downloads)
    python scripts/verify_models.py --neural  # also live-test cached neural weights

Exits 0 when all checks pass, 1 on failure.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import subprocess
import sys
from pathlib import Path

import numpy as np

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.engine.planner import ENHANCE_STEPS, PRESETS, TRANSCRIBE_PREFER
from neiro.engine.registry import ModelEntry, default_registry

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_DIR = ROOT / "src" / "neiro" / "manifests"

REQUIRES_TO_EXTRA: dict[str, str] = {
    "audio_separator": "separation",
    "piano_transcription_inference": "piano",
    "basic_pitch": "basicpitch",
    "matchering": "restoration",
    "audiosr": "superres",
    "huggingface_hub": "downloader",
    "demucs": "demucs",
    "torch": "demucs",
}

# Neural separation/enhancement backends need at least ~1 s at 44.1 kHz.
MIN_NEURAL_SECONDS = 3.0
NEURAL_SR = 44100


def _stereo(seconds: float, sr: int = NEURAL_SR) -> AudioTensor:
    t = np.arange(int(seconds * sr)) / sr
    left = (0.4 * np.sin(2 * np.pi * 220 * t) + 0.3 * np.sin(2 * np.pi * 660 * t)).astype(
        np.float32
    )
    right = (0.4 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    return AudioTensor(np.stack([left, right]), sr)


def _mono(seconds: float = 1.5, sr: int = 16000) -> AudioTensor:
    t = np.arange(int(seconds * sr)) / sr
    x = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    return AudioTensor(x[np.newaxis, :], sr)


def verify_structural(entry: ModelEntry) -> list[str]:
    issues: list[str] = []
    try:
        entry._adapter_class()
        entry.instantiate()
    except Exception as exc:
        issues.append(f"adapter/instantiate: {exc}")

    for mod in entry.manifest.get("requires", []):
        if mod not in REQUIRES_TO_EXTRA:
            issues.append(f"requires {mod!r} not mapped to pyproject extra")

    missing = []
    for mod in entry.manifest.get("requires", []):
        try:
            if importlib.util.find_spec(mod) is None:
                missing.append(mod)
        except (ImportError, ValueError):
            missing.append(mod)
    avail = entry.available()
    if missing and avail:
        issues.append(f"available=True but missing deps {missing}")
    if not missing and not avail:
        issues.append("available=False but requires present")

    for mem in entry.manifest.get("params", {}).get("members", []):
        try:
            spec = mem["adapter"]
            mod_name, _, cls_name = spec.partition(":")
            getattr(importlib.import_module(mod_name), cls_name)
        except Exception as exc:
            issues.append(f"ensemble member: {exc}")

    return issues


def smoke_inference(entry: ModelEntry, *, neural: bool) -> tuple[str, str]:
    if not entry.available():
        return "deferred", "optional dep not installed"

    is_dsp = entry.id.startswith("dsp-") or entry.manifest.get("framework") == "numpy"

    try:
        inst = entry.instantiate()
    except Exception as exc:
        return "failed", f"instantiate: {exc}"

    task = entry.task
    if task == "separate":
        if is_dsp:
            out = inst.separate(_stereo(2.0))
            return ("live", f"stems={list(out)}") if out else ("failed", "empty output")
        if not neural or not entry.downloaded():
            return (
                "structural",
                "neural (weights not cached)" if not entry.downloaded() else "skipped",
            )
        out = inst.separate(_stereo(MIN_NEURAL_SECONDS))
        return ("live", f"stems={list(out)}") if out else ("failed", "empty output")

    if task == "enhance":
        audio = _mono(2.0, sr=44100) if not is_dsp else _mono()
        if not is_dsp and (not neural or not entry.downloaded()):
            return (
                "structural",
                "neural (weights not cached)" if not entry.downloaded() else "skipped",
            )
        try:
            out = inst.enhance(audio)
        except RuntimeError as exc:
            if not is_dsp and "too short" in str(exc).lower():
                return "structural", str(exc)
            raise
        return ("live", "enhance OK") if out is not None else ("failed", "None")

    if task == "transcribe":
        if is_dsp:
            out = inst.transcribe(_mono())
            return (
                ("live", "NoteStream OK")
                if isinstance(out, NoteStream)
                else ("failed", type(out).__name__)
            )
        if not neural or not entry.downloaded():
            return (
                "structural",
                "neural (weights not cached)" if not entry.downloaded() else "skipped",
            )
        out = inst.transcribe(_mono(seconds=2.0))
        return (
            ("live", "NoteStream OK")
            if isinstance(out, NoteStream)
            else ("failed", type(out).__name__)
        )

    return "structural", f"task {task}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--neural", action="store_true", help="live-test cached neural weights")
    args = parser.parse_args()

    reg = default_registry()
    entries = reg.all()
    all_ids = {e.id for e in entries}
    failures: list[str] = []
    rows: list[dict] = []

    print("=== Model Compatibility Verification ===\n")

    manifest_files = sorted(MANIFEST_DIR.glob("*.json"))
    if len(entries) != len(manifest_files):
        failures.append(f"registry {len(entries)} != manifests {len(manifest_files)}")

    for preset, spec in PRESETS.items():
        for mid in spec.get("prefer", []):
            if mid not in all_ids:
                failures.append(f"preset {preset!r} -> missing {mid!r}")

    for mid in TRANSCRIBE_PREFER:
        if mid not in all_ids:
            failures.append(f"TRANSCRIBE_PREFER missing {mid!r}")

    for step, prefs in ENHANCE_STEPS.items():
        for mid in prefs:
            if mid not in all_ids:
                failures.append(f"ENHANCE_STEPS[{step!r}] missing {mid!r}")

    cli_out = subprocess.run(
        ["neiro", "models"], capture_output=True, text=True, check=False
    ).stdout
    for entry in entries:
        issues = verify_structural(entry)
        smoke_status, smoke_detail = smoke_inference(entry, neural=args.neural)

        if issues:
            status = "failed"
            failures.extend(f"{entry.id}: {i}" for i in issues)
        elif smoke_status == "failed":
            status = "failed"
            failures.append(f"{entry.id}: {smoke_detail}")
        elif smoke_status == "live":
            status = "live-tested"
        elif smoke_status == "deferred":
            status = "deferred"
        else:
            status = "compatible"

        if entry.id not in cli_out:
            failures.append(f"{entry.id}: absent from neiro models output")

        rows.append(
            {
                "id": entry.id,
                "task": entry.task,
                "available": entry.available(),
                "downloaded": entry.downloaded(),
                "requires": ",".join(entry.manifest.get("requires", [])) or "—",
                "status": status,
                "smoke": smoke_detail,
            }
        )

    print(
        f"{'Model':<32} {'Task':<10} {'Avail':<6} {'DL':<6} {'Status':<14} {'Requires':<20} Smoke"
    )
    print("-" * 120)
    for r in rows:
        print(
            f"{r['id']:<32} {r['task']:<10} "
            f"{str(r['available']):<6} {str(r['downloaded']):<6} "
            f"{r['status']:<14} {r['requires']:<20} {r['smoke']}"
        )

    print(
        f"\nManifests: {len(manifest_files)} | Registry: {len(entries)} | Presets: {len(PRESETS)}"
    )
    print(f"Failures: {len(failures)}")
    if failures:
        print("\n=== FAILURES ===")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll compatibility checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
