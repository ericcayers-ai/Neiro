"""Tests for quality tiers (Draft/Standard/Reference) wired into planning
(roadmap §5.2, item 1)."""

from __future__ import annotations

import json

import pytest
import soundfile as sf

from neiro.engine.estimator import TimeEstimator, estimate_seconds, record_run
from neiro.engine.planner import PRESETS, TIER_PARAMS, plan_separation
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager


def _write_wav(tmp_path, stereo_mix):
    wav = tmp_path / "mix.wav"
    sf.write(str(wav), stereo_mix.samples.T, stereo_mix.sample_rate, subtype="FLOAT")
    return wav


# ---- tier parameters --------------------------------------------------------


def test_tier_params_are_monotonically_more_thorough():
    order = ["draft", "standard", "reference"]
    overlaps = [TIER_PARAMS[t]["overlap"] for t in order]
    assert overlaps == sorted(overlaps)
    assert TIER_PARAMS["draft"]["tta"] is False
    assert TIER_PARAMS["standard"]["tta"] is True
    assert TIER_PARAMS["reference"]["tta"] is True


def test_unknown_quality_tier_rejected(tmp_path, stereo_mix):
    wav = _write_wav(tmp_path, stereo_mix)
    with pytest.raises(ValueError, match="unknown quality tier"):
        plan_separation(
            wav, "vocals", default_registry(), VRAMManager(), quality="ultra", auto_download=False
        )


@pytest.mark.parametrize("tier", ["draft", "standard", "reference"])
def test_plan_separation_applies_requested_tier(tmp_path, stereo_mix, tier):
    wav = _write_wav(tmp_path, stereo_mix)
    plan = plan_separation(
        wav, "vocals", default_registry(), VRAMManager(), quality=tier, auto_download=False
    )
    assert plan.quality == tier
    assert any(f"quality={tier}" in note for note in plan.notes)


def test_plan_separation_defaults_to_preset_tier(tmp_path, stereo_mix):
    wav = _write_wav(tmp_path, stereo_mix)
    plan = plan_separation(
        wav, "vocals-best", default_registry(), VRAMManager(), auto_download=False
    )
    assert plan.quality == PRESETS["vocals-best"]["quality"]


def test_draft_tier_never_silent_bleed_suppression_still_applies(tmp_path, stereo_mix):
    """Draft tier must not disable bleed suppression by default (roadmap:
    'never silent in Draft')."""
    wav = _write_wav(tmp_path, stereo_mix)
    plan = plan_separation(
        wav,
        "vocals-ensemble",
        default_registry(),
        VRAMManager(),
        quality="draft",
        auto_download=False,
    )
    assert plan.bleed_node is not None


def test_bleed_suppress_flag_is_ab_able(tmp_path, stereo_mix):
    wav = _write_wav(tmp_path, stereo_mix)
    plan_on = plan_separation(
        wav,
        "vocals-ensemble",
        default_registry(),
        VRAMManager(),
        quality="draft",
        auto_download=False,
        bleed_suppress=True,
    )
    plan_off = plan_separation(
        wav,
        "vocals-ensemble",
        default_registry(),
        VRAMManager(),
        quality="draft",
        auto_download=False,
        bleed_suppress=False,
    )
    assert plan_on.bleed_node is not None
    assert plan_off.bleed_node is None


# ---- per-machine time estimates --------------------------------------------


def test_time_estimator_uses_heuristic_before_calibration(tmp_path):
    est = TimeEstimator(tmp_path / "stats.json")
    seconds = est.estimate("some-model", "cpu", 10.0, quality_class="standard")
    assert seconds == pytest.approx(6.0, rel=1e-6)  # 0.6 rate * 10s audio
    assert est.samples_for("some-model", "cpu") == 0


def test_time_estimator_calibrates_from_recorded_runs(tmp_path):
    path = tmp_path / "stats.json"
    est = TimeEstimator(path)
    est.record("model-a", "cpu", audio_seconds=10.0, elapsed_seconds=2.0)
    assert est.samples_for("model-a", "cpu") == 1
    seconds = est.estimate("model-a", "cpu", 20.0)
    assert seconds == pytest.approx(4.0, rel=1e-6)  # rate 0.2 * 20s

    # A second run should average into the running rate rather than replace it.
    est.record("model-a", "cpu", audio_seconds=10.0, elapsed_seconds=4.0)
    assert est.samples_for("model-a", "cpu") == 2
    updated_rate = json.loads(path.read_text())["model-a::cpu"]["rate"]
    assert updated_rate == pytest.approx(0.3, rel=1e-6)  # mean of 0.2 and 0.4


def test_time_estimator_persists_across_instances(tmp_path):
    path = tmp_path / "stats.json"
    TimeEstimator(path).record("model-b", "cuda", audio_seconds=5.0, elapsed_seconds=1.0)
    reloaded = TimeEstimator(path)
    assert reloaded.samples_for("model-b", "cuda") == 1
    assert reloaded.estimate("model-b", "cuda", 5.0) == pytest.approx(1.0, rel=1e-6)


def test_module_level_estimate_and_record_round_trip(tmp_path, monkeypatch):
    stats_path = tmp_path / "global_stats.json"
    monkeypatch.setattr("neiro.engine.estimator._default", None)
    monkeypatch.setattr("neiro.engine.estimator.default_stats_path", lambda: stats_path)
    record_run("model-c", "cpu", audio_seconds=8.0, elapsed_seconds=4.0)
    seconds = estimate_seconds("model-c", "cpu", 16.0)
    assert seconds == pytest.approx(8.0, rel=1e-6)  # rate 0.5 * 16s


def test_plan_separation_reports_estimated_seconds(tmp_path, stereo_mix):
    wav = _write_wav(tmp_path, stereo_mix)
    plan = plan_separation(wav, "vocals", default_registry(), VRAMManager(), auto_download=False)
    assert plan.estimated_seconds is not None
    assert plan.estimated_seconds > 0
    assert any("estimated" in note for note in plan.notes)
