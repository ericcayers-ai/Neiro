"""Unit tests for symbolic hybrid / ensemble merge (Wave 4)."""

from neiro.engine.artifacts import NoteEvent, NoteStream
from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import ExecutionContext
from neiro.engine.planner import plan_transcription
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager
from neiro.symbolic.orchestrate import ensemble_merge, hybrid_merge, hybrid_merge_many


def _ev(onset, pitch, conf=0.8, provenance=""):
    return NoteEvent(onset, onset + 0.4, pitch, 80, confidence=conf, provenance=provenance)


def test_hybrid_merge_stem_wins_and_mix_fills():
    mix = NoteStream(
        (
            _ev(1.0, 60, 0.5, "mix"),
            _ev(2.0, 64, 0.9, "mix"),  # no stem match → fill
            _ev(3.0, 72, 0.7, "mix"),  # octave of stem 60 at ~3.0
        ),
        source="mix",
    )
    stem = NoteStream((_ev(1.01, 60, 0.95, "stem"), _ev(3.0, 60, 0.9, "stem")), source="stem")
    merged = hybrid_merge(mix, stem)
    pitches = [e.pitch for e in merged.events]
    assert 64 in pitches  # mix fill kept
    # octave-matched mix note at 3.0 dropped; stem C4 kept
    at_three = [e for e in merged.events if abs(e.onset - 3.0) < 0.02]
    assert len(at_three) == 1 and at_three[0].pitch == 60
    assert "hybrid" in (merged.source or "")


def test_hybrid_merge_many_does_not_duplicate_fills():
    mix = NoteStream((_ev(1.0, 67, 0.8, "mix"),), source="mix")
    stems = {
        "guitar": NoteStream((_ev(0.5, 55, 0.9),), source="g"),
        "piano": NoteStream((_ev(2.0, 72, 0.9),), source="p"),
    }
    out = hybrid_merge_many(mix, stems)
    # Fill assigned to exactly one track (stable sorted order → guitar first).
    fill_count = sum(1 for s in out.values() for e in s.events if e.pitch == 67)
    assert fill_count == 1


def test_ensemble_merge_votes_and_weights():
    a = NoteStream((_ev(1.0, 60, 0.6, "a"), _ev(2.0, 64, 0.9, "a")), source="a")
    b = NoteStream((_ev(1.02, 60, 0.9, "b"), _ev(3.0, 67, 0.8, "b")), source="b")
    merged = ensemble_merge([a, b], weights=[1.0, 2.0])
    pitches = sorted(e.pitch for e in merged.events)
    assert pitches == [60, 64, 67]
    c60 = next(e for e in merged.events if e.pitch == 60)
    # Heavier member b should dominate onset/confidence directionally.
    assert c60.confidence > 0.6
    assert "ensemble" in (merged.source or "")


def test_ensemble_merge_single_passthrough():
    only = NoteStream((_ev(0.5, 60),), source="only")
    assert ensemble_merge([only]).events == only.events


def test_plan_ensemble_with_two_dsp_members(tmp_path):
    import numpy as np
    import soundfile as sf

    sr = 16000
    t = np.arange(int(1.2 * sr)) / sr
    x = (0.3 * np.sin(2 * np.pi * 261.63 * t)).astype(np.float32)
    wav = tmp_path / "ens.wav"
    sf.write(str(wav), x, sr, subtype="FLOAT")

    plan = plan_transcription(
        wav,
        default_registry(),
        VRAMManager(),
        mode="ensemble",
        members=["dsp-yin", "drums-dsp"],
        auto_download=False,
    )
    assert plan.model_id == "tr-ensemble-default"
    assert len(plan.transcribe_nodes) >= 2
    assert any("ensemble member" in n for n in plan.notes)

    ctx = ExecutionContext(cache=ArtifactCache())
    out = plan.graph.execute(ctx, targets=[plan.compile_node])
    timeline = out[plan.compile_node]["timeline"]
    assert timeline.total_events() >= 1


def test_plan_single_model_unchanged(tmp_path):
    import numpy as np
    import soundfile as sf

    sr = 16000
    t = np.arange(sr) / sr
    x = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    wav = tmp_path / "single.wav"
    sf.write(str(wav), x, sr, subtype="FLOAT")

    plan = plan_transcription(
        wav,
        default_registry(),
        VRAMManager(),
        mode="direct",
        model="dsp-yin",
        auto_download=False,
    )
    assert plan.model_id == "dsp-yin"
    assert plan.transcribe_nodes == ["transcribe"]
    assert plan.compile_node == "compile"
