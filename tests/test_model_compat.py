"""Model compatibility: every manifest, preset, and planner reference is valid.

Structural checks run in CI with no model downloads. DSP models get a live
smoke inference. Neural backends are verified for adapter import/instantiation
and availability probing; live neural inference is optional (weights cached).
"""

from __future__ import annotations

import importlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.engine.planner import ENHANCE_STEPS, PRESETS, TRANSCRIBE_PREFER
from neiro.engine.registry import Registry, default_registry

MANIFEST_DIR = Path(__file__).resolve().parents[1] / "src" / "neiro" / "manifests"

# Manifest ``requires`` module -> pyproject optional-deps group name.
REQUIRES_TO_EXTRA: dict[str, str] = {
    "audio_separator": "separation",
    "piano_transcription_inference": "piano",
    "basic_pitch": "basicpitch",
    "matchering": "restoration",
    "audiosr": "superres",
    "huggingface_hub": "downloader",
    "demucs": "demucs",
    "torch": "demucs",
    "torchaudio": "apollo",
    "whisper": "lyrics",
    "df": "deepfilternet",
    "look2hear": "apollo",
    "apollo": "apollo",
    "scnet": "scnet",
    "larsnet": "larsnet",
    "medley_vox": "medley_vox",
    "sonicmaster": "sonicmaster",
    "transkun": "transkun",
    "omnizart": "omnizart",
    "voicefixer": "voicefixer",
    "mt3_infer": "mt3",
    "timbre_amt": "timbre_amt",
    "noise_to_notes": "noise_to_notes",
}

WEIGHT_KINDS = {"http", "hf_hub", "managed"}


@pytest.fixture
def reg() -> Registry:
    return default_registry()


def _stereo(seconds: float = 2.0, sr: int = 44100) -> AudioTensor:
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


def test_manifest_files_match_registry(reg):
    files = sorted(MANIFEST_DIR.glob("*.json"))
    assert len(reg.all()) == len(files)
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["id"] in {e.id for e in reg.all()}


def test_every_manifest_has_required_fields_and_license(reg):
    for entry in reg.all():
        assert entry.task in {"separate", "transcribe", "enhance", "analyze"}
        assert entry.manifest.get("adapter")
        assert entry.license_spdx
        for w in entry.weights:
            assert w.get("kind") in WEIGHT_KINDS


def test_requires_modules_map_to_pyproject_extras(reg):
    for entry in reg.all():
        for mod in entry.manifest.get("requires", []):
            assert mod in REQUIRES_TO_EXTRA, f"{entry.id}: unmapped requires {mod!r}"


def test_every_entry_adapter_imports_and_instantiates(reg):
    for entry in reg.all():
        cls = entry._adapter_class()
        inst = entry.instantiate()
        assert cls is not None and inst is not None


def test_availability_probe_matches_requires(reg):
    for entry in reg.all():
        missing = []
        for mod in entry.manifest.get("requires", []):
            try:
                if importlib.util.find_spec(mod) is None:
                    missing.append(mod)
            except (ImportError, ValueError):
                missing.append(mod)
        avail = entry.available()
        if missing:
            assert not avail, f"{entry.id}: should be unavailable (missing {missing})"
        elif not avail:
            # Adapter import itself failed — still a structural problem.
            entry._adapter_class()


def test_ensemble_member_adapters_exist(reg):
    ids = {e.id for e in reg.all()}
    for entry in reg.all():
        for mem in entry.manifest.get("params", {}).get("members", []):
            mid = mem.get("model_id")
            if mid:
                assert mid in ids, f"{entry.id}: member model_id {mid!r} not registered"
                continue
            spec = mem.get("adapter")
            assert spec, f"{entry.id}: member needs model_id or adapter ({mem!r})"
            mod_name, _, cls_name = spec.partition(":")
            cls = getattr(importlib.import_module(mod_name), cls_name)
            assert cls is not None


def test_all_presets_reference_registered_models(reg):
    ids = {e.id for e in reg.all()}
    for preset, spec in PRESETS.items():
        for mid in spec.get("prefer", []):
            assert mid in ids, f"preset {preset!r} -> missing {mid!r}"


def test_transcribe_prefer_and_enhance_steps_reference_models(reg):
    ids = {e.id for e in reg.all()}
    for mid in TRANSCRIBE_PREFER:
        assert mid in ids
    for step, prefs in ENHANCE_STEPS.items():
        for mid in prefs:
            assert mid in ids, f"enhance step {step!r} -> missing {mid!r}"


@pytest.mark.parametrize(
    "model_id",
    [
        "dsp-center",
        "dsp-center-ensemble",
        "dsp-hpss",
        "dsp-declip",
        "dsp-dehum",
        "dsp-denoise",
        "dsp-normalize",
        "dsp-yin",
    ],
)
def test_dsp_models_live_smoke(reg, model_id):
    entry = reg.get(model_id)
    assert entry.available()
    inst = entry.instantiate()
    if entry.task == "separate":
        out = inst.separate(_stereo())
        assert out and isinstance(out, dict)
        assert set(out) >= set(entry.stems)
    elif entry.task == "enhance":
        out = inst.enhance(_mono())
        assert out is not None
    elif entry.task == "transcribe":
        out = inst.transcribe(_mono())
        assert isinstance(out, NoteStream)


def test_matchering_live_smoke_if_available(reg):
    entry = reg.get("matchering")
    if not entry.available():
        pytest.skip("matchering not installed")
    out = entry.instantiate().enhance(_mono(sr=44100))
    assert out is not None


@pytest.mark.slow
def test_neural_separation_live_if_downloaded(reg):
    """Optional: runs only when weights are already cached (no download)."""
    entry = reg.get("bs-roformer-1297")
    if not entry.available() or not entry.downloaded():
        pytest.skip("bs-roformer-1297 not ready")
    out = entry.instantiate().separate(_stereo(seconds=3.0))
    assert {"vocals", "instrumental"} <= set(out)


@pytest.mark.slow
def test_neural_ensemble_live_if_downloaded(reg, stereo_mix):
    entry = reg.get("vocals-neural-ensemble")
    if not entry.available() or not entry.downloaded():
        pytest.skip("vocals-neural-ensemble not ready")
    out = entry.instantiate().separate(_stereo(seconds=3.0))
    if not out:
        pytest.skip("neural ensemble inference returned no stems")
    assert {"vocals", "instrumental"} <= set(out)
