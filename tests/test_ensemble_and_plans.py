import numpy as np
import pytest
import soundfile as sf

from neiro.adapters.dsp_separators import CenterSeparator
from neiro.dsp.ensemble import fuse_stems, tta_separate
from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import ExecutionContext
from neiro.engine.planner import plan_enhancement, plan_separation, plan_transcription
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager

# ---- fusion -----------------------------------------------------------------


def test_fuse_identical_members_is_identity(stereo_mix):
    sep = CenterSeparator()
    stems = {k: v.samples for k, v in sep.separate(stereo_mix).items()}
    fused = fuse_stems([stems, stems], stereo_mix.sample_rate, mode="mean")
    for name in stems:
        a, b = fused[name], stems[name]
        interior = slice(4096, a.shape[1] - 4096)
        rms = np.sqrt(np.mean((a[:, interior] - b[:, interior]) ** 2))
        assert rms < 1e-3


def test_fuse_rejects_mismatched_stems(stereo_mix):
    with pytest.raises(ValueError, match="disagree"):
        fuse_stems(
            [{"vocals": stereo_mix.samples}, {"drums": stereo_mix.samples}],
            stereo_mix.sample_rate,
        )


def test_fuse_aligns_mismatched_lengths(stereo_mix):
    a = stereo_mix.samples
    b = stereo_mix.samples[:, : a.shape[1] - 64]
    fused = fuse_stems(
        [{"vocals": a, "instrumental": a}, {"vocals": b, "instrumental": b}],
        stereo_mix.sample_rate,
        weights=[1.0, 1.0],
        mode="mean",
    )
    assert fused["vocals"].shape == a.shape


def test_ensemble_skips_zero_weight_members(stereo_mix):
    from neiro.adapters.dsp_separators import CenterSeparator
    from neiro.adapters.ensemble_separator import EnsembleSeparator

    class TrackingSeparator(CenterSeparator):
        calls = 0

        def separate(self, audio):
            type(self).calls += 1
            return super().separate(audio)

    TrackingSeparator.calls = 0
    ens = EnsembleSeparator(
        model_id="test-ens",
        members=[
            {"adapter": "neiro.adapters.dsp_separators:CenterSeparator", "weight": 1.0},
            {"adapter": "neiro.adapters.dsp_separators:CenterSeparator", "weight": 0.0},
        ],
        tta=False,
    )
    # Replace second member with a tracker after instantiate.
    ens.members[1] = TrackingSeparator()
    ens.weights = [1.0, 0.0]
    stems = ens.separate(stereo_mix)
    assert TrackingSeparator.calls == 0
    assert stems["vocals"].samples.shape == stereo_mix.samples.shape


def test_tta_preserves_alignment(stereo_mix):
    sep = CenterSeparator()
    plain = sep.separate(stereo_mix)
    tta = tta_separate(sep, stereo_mix)
    assert set(tta) == set(plain)
    for name in plain:
        # Linear DSP separator: TTA views should agree closely with the plain run.
        diff = np.max(np.abs(tta[name].samples - plain[name].samples))
        assert diff < 0.05


# ---- ensemble via registry ----------------------------------------------------


def test_ensemble_manifest_instantiates_and_separates(stereo_mix):
    reg = default_registry()
    entry = reg.get("dsp-center-ensemble")
    assert entry.available()
    sep = entry.instantiate()
    stems = sep.separate(stereo_mix)
    assert set(stems) == {"vocals", "instrumental"}
    assert stems["vocals"].samples.shape == stereo_mix.samples.shape


def test_separation_plan_ensemble_preset(tmp_path, stereo_mix):
    wav = tmp_path / "mix.wav"
    sf.write(str(wav), stereo_mix.samples.T, stereo_mix.sample_rate, subtype="FLOAT")
    plan = plan_separation(wav, "vocals-ensemble", default_registry(), VRAMManager())
    assert plan.model_id == "dsp-center-ensemble"


# ---- transcription plans ------------------------------------------------------


def _write_melody_wav(tmp_path, stereo=False):
    sr = 16000
    t = np.arange(int(0.6 * sr)) / sr
    notes = [261.63, 329.63]
    parts = []
    for f in notes:
        x = 0.5 * np.sin(2 * np.pi * f * t)
        fade = 160
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
        parts.append(x)
        parts.append(np.zeros(int(0.1 * sr)))
    mono = np.concatenate(parts).astype(np.float32)
    if stereo:
        # Genuinely wide stereo: an independent side component in R only.
        # (R = 0.5*L would be *correctly* flagged effectively-mono — correlation
        # is scale-invariant.)
        side = (0.2 * np.sin(2 * np.pi * 660.0 * np.arange(mono.size) / sr)).astype(np.float32)
        data = np.stack([mono, mono + side])
    else:
        data = mono[np.newaxis, :]
    wav = tmp_path / ("melody_stereo.wav" if stereo else "melody.wav")
    sf.write(str(wav), data.T, sr, subtype="FLOAT")
    return wav


def test_transcription_direct_mode(tmp_path):
    wav = _write_melody_wav(tmp_path)
    plan = plan_transcription(
        wav, default_registry(), VRAMManager(), mode="direct", model="dsp-yin", auto_download=False
    )
    assert not plan.used_split
    ctx = ExecutionContext(cache=ArtifactCache())
    out = plan.graph.execute(ctx, targets=[plan.compile_node])
    timeline = out[plan.compile_node]["timeline"]
    pitches = [e.pitch for _, s in timeline.tracks for e in s.events]
    assert pitches == [60, 64]


def test_transcription_auto_splits_on_wide_stereo(tmp_path):
    wav = _write_melody_wav(tmp_path, stereo=True)
    plan = plan_transcription(
        wav, default_registry(), VRAMManager(), mode="auto", model="dsp-yin", auto_download=False
    )
    assert plan.used_split  # stereo, not effectively mono -> split path
    ctx = ExecutionContext(cache=ArtifactCache())
    out = plan.graph.execute(ctx, targets=[plan.compile_node])
    assert out[plan.compile_node]["timeline"].total_events() >= 1


# ---- enhancement plans ---------------------------------------------------------


def test_enhancement_auto_detects_clipping(tmp_path):
    sr = 44100
    t = np.arange(sr) / sr
    clipped = np.clip(np.sin(2 * np.pi * 220 * t), -0.6, 0.6).astype(np.float32)
    # Re-scale so clipped samples sit at the digital ceiling, as real clipping does.
    clipped /= 0.6
    wav = tmp_path / "clipped.wav"
    sf.write(str(wav), clipped, sr, subtype="FLOAT")

    plan = plan_enhancement(wav, default_registry(), VRAMManager(), chain=None, auto_download=False)
    assert "declip" in plan.chain

    ctx = ExecutionContext(cache=ArtifactCache())
    out = plan.graph.execute(ctx, targets=[plan.output_node])
    restored = out[plan.output_node]["audio"]
    assert restored.samples.shape[1] == clipped.size


def test_enhancement_explicit_chain(tmp_path):
    sr = 44100
    x = (0.3 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype(np.float32)
    wav = tmp_path / "tone.wav"
    sf.write(str(wav), x, sr, subtype="FLOAT")
    plan = plan_enhancement(
        wav, default_registry(), VRAMManager(), chain=["dehum", "normalize"], auto_download=False
    )
    assert plan.chain == ["dehum", "normalize"]
    ctx = ExecutionContext(cache=ArtifactCache())
    out = plan.graph.execute(ctx, targets=[plan.output_node])
    peak = float(np.max(np.abs(out[plan.output_node]["audio"].samples)))
    assert abs(20 * np.log10(peak) - (-1.0)) < 0.2


def test_enhancement_rejects_unknown_step(tmp_path):
    sr = 8000
    wav = tmp_path / "x.wav"
    sf.write(str(wav), np.zeros(sr, dtype=np.float32), sr, subtype="FLOAT")
    with pytest.raises(ValueError, match="unknown enhancement step"):
        plan_enhancement(wav, default_registry(), VRAMManager(), chain=["reverse-entropy"])
