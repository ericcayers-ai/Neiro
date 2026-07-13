import numpy as np

from neiro.analysis import analyze
from neiro.engine.cache import ArtifactCache
from neiro.engine.graph import ExecutionContext
from neiro.engine.planner import plan_separation
from neiro.engine.registry import default_registry
from neiro.engine.vram import VRAMManager


def test_registry_loads_builtin_models():
    reg = default_registry()
    ids = {e.id for e in reg.all()}
    assert {"dsp-center", "dsp-hpss", "vocals-neural-ensemble"}.issubset(ids)
    # DSP separators are always available (no heavy deps).
    assert reg.get("dsp-center").available()


def test_best_for_prefers_available():
    reg = default_registry()
    entry = reg.best_for("separate", "draft", stems={"vocals", "instrumental"})
    assert entry is not None
    assert entry.available()


def test_analysis_report_is_sane(stereo_mix):
    report = analyze(stereo_mix)
    d = report.as_dict()
    assert d["channels"] == 2
    assert d["duration_seconds"] > 1.5
    assert report.estimated_key is not None
    assert -60.0 < d["integrated_lufs"] < 0.0
    assert not report.is_effectively_mono


def test_mono_detection(mono_tone):
    # Duplicate a mono tone into two channels -> effectively mono.
    import numpy as np

    from neiro.engine.artifacts import AudioTensor

    dup = AudioTensor(np.repeat(mono_tone.samples, 2, axis=0), mono_tone.sample_rate)
    report = analyze(dup)
    assert report.is_effectively_mono


def test_analysis_detects_instruments(stereo_mix):
    report = analyze(stereo_mix)
    assert isinstance(report.instruments, tuple)
    for hint in report.instruments:
        assert "instrument" in hint and "confidence" in hint and "status" in hint


def test_end_to_end_separation(tmp_path, stereo_mix):
    # Write the fixture to a WAV so the ingest path is exercised too.
    import soundfile as sf

    wav = tmp_path / "mix.wav"
    sf.write(str(wav), stereo_mix.samples.T, stereo_mix.sample_rate, subtype="FLOAT")

    reg = default_registry()
    vram = VRAMManager()
    plan = plan_separation(wav, "vocals", reg, vram)
    assert plan.model_id == "dsp-center"

    ctx = ExecutionContext(cache=ArtifactCache())
    outputs = plan.graph.execute(ctx, targets=[plan.residual_node])

    stems = outputs[plan.separate_node]
    assert set(stems) == {"vocals", "instrumental"}

    # Null test: residual is near-silent in the interior (source fully accounted for).
    resid = outputs[plan.residual_node]["residual"].samples
    a, b = 4096, resid.shape[1] - 4096
    assert np.sqrt(np.mean(resid[:, a:b] ** 2)) < 1e-2

    # Provenance survived the pipeline.
    assert any("dsp-center" in p for p in stems["vocals"].provenance)


def test_disk_cache_persists(tmp_path):
    from neiro.engine.cache import ArtifactCache, cache_key

    disk = tmp_path / "cache"
    c1 = ArtifactCache(max_entries=8, disk_dir=disk)
    key = cache_key("n", "cfg", ["in"])
    assert c1.get_or_compute(key, lambda: {"v": 1}) == {"v": 1}
    c2 = ArtifactCache(max_entries=8, disk_dir=disk)
    assert c2.get_or_compute(key, lambda: {"v": 99}) == {"v": 1}
    assert c2.hits == 1


def test_export_metadata_sidecar(tmp_path, stereo_mix):
    from neiro.io import write_audio, write_export_metadata

    p = write_audio(stereo_mix, tmp_path / "stem.wav", fmt="wav", bit_depth=16)
    meta = write_export_metadata(
        p, model_id="dsp-center", license_spdx="MIT", provenance=("dsp-center",)
    )
    assert meta.is_file()
    assert "dsp-center" in meta.read_text()


def test_cache_reuse_across_runs(tmp_path, stereo_mix):
    import soundfile as sf

    wav = tmp_path / "mix.wav"
    sf.write(str(wav), stereo_mix.samples.T, stereo_mix.sample_rate, subtype="FLOAT")

    reg = default_registry()
    vram = VRAMManager()
    plan = plan_separation(wav, "vocals", reg, vram)
    cache = ArtifactCache()

    ctx1 = ExecutionContext(cache=cache)
    plan.graph.execute(ctx1, targets=[plan.residual_node])
    misses_after_first = cache.misses

    ctx2 = ExecutionContext(cache=cache)
    plan.graph.execute(ctx2, targets=[plan.residual_node])
    # Second run should be all hits: no new misses.
    assert cache.misses == misses_after_first
    assert cache.hits > 0
