import numpy as np
import pytest

from neiro.engine.artifacts import AudioTensor
from neiro.engine.cache import ArtifactCache, cache_key
from neiro.engine.graph import ExecutionContext, Graph, Node
from neiro.engine.vram import Device, VRAMManager

# --- artifacts -------------------------------------------------------------


def test_audiotensor_normalizes_mono():
    a = AudioTensor(np.zeros(1000, dtype=np.float32), 44100)
    assert a.channels == 1
    assert a.frames == 1000


def test_content_key_changes_with_content(stereo_mix):
    k1 = stereo_mix.content_key()
    altered = AudioTensor(stereo_mix.samples * 0.5, stereo_mix.sample_rate)
    assert altered.content_key() != k1


# --- cache -----------------------------------------------------------------


def test_cache_memoises():
    cache = ArtifactCache()
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return 42

    k = cache_key("node", "cfg", ["a"])
    assert cache.get_or_compute(k, compute) == 42
    assert cache.get_or_compute(k, compute) == 42
    assert calls["n"] == 1
    assert cache.hits == 1


# --- graph -----------------------------------------------------------------


class _Const(Node):
    def __init__(self, node_id, value):
        super().__init__(node_id)
        self.value = value

    def config_repr(self):
        return f"Const({self.value})"

    def run(self, ctx, inputs):
        return {"out": AudioTensor(np.full((1, 10), self.value, dtype=np.float32), 8000)}


class _Add(Node):
    def __init__(self, node_id, a, b):
        super().__init__(node_id, inputs={"a": a, "b": b})

    def run(self, ctx, inputs):
        s = inputs["a"].samples + inputs["b"].samples
        return {"out": AudioTensor(s, 8000)}


def test_graph_executes_in_order():
    g = Graph()
    g.add(_Const("x", 1.0))
    g.add(_Const("y", 2.0))
    g.add(_Add("sum", ("x", "out"), ("y", "out")))
    ctx = ExecutionContext(cache=ArtifactCache())
    out = g.execute(ctx)
    assert float(out["sum"]["out"].samples[0, 0]) == 3.0


def test_graph_detects_cycle():
    g = Graph()
    g.add(_Add("a", ("b", "out"), ("b", "out")))
    g.add(_Add("b", ("a", "out"), ("a", "out")))
    with pytest.raises(ValueError, match="cycle"):
        g.topological_order()


def test_graph_partial_execution_only_runs_ancestors():
    g = Graph()
    g.add(_Const("x", 1.0))
    g.add(_Const("y", 2.0))
    g.add(_Add("sum", ("x", "out"), ("y", "out")))
    ctx = ExecutionContext(cache=ArtifactCache())
    out = g.execute(ctx, targets=["x"])
    assert "x" in out and "sum" not in out


def test_graph_reports_dag_level_fraction():
    """Overall fraction advances across nodes (not stuck at each node's local 1.0)."""
    events = []

    class _Reporting(Node):
        def __init__(self, node_id, deps=None):
            super().__init__(node_id, inputs=deps or {})

        def run(self, ctx, inputs):
            ctx.report(self.node_id, "work", 0.5, "halfway")
            return {"out": AudioTensor(np.zeros((1, 4), dtype=np.float32), 8000)}

    g = Graph()
    g.add(_Reporting("a"))
    g.add(_Reporting("b", {"x": ("a", "out")}))
    g.add(_Reporting("c", {"x": ("b", "out")}))
    ctx = ExecutionContext(
        cache=ArtifactCache(),
        progress=lambda p: events.append((p.node_id, p.stage, p.fraction)),
    )
    g.execute(ctx)
    # Three nodes → mid-work on first is ~0.5/3; done on last is 1.0.
    mid_a = [f for nid, stage, f in events if nid == "a" and stage == "work"]
    assert mid_a and abs(mid_a[0] - (0 + 0.5) / 3) < 1e-6
    done_fracs = [f for _n, stage, f in events if stage == "done"]
    assert done_fracs
    assert abs(done_fracs[-1] - 1.0) < 1e-6
    assert any(abs(f - 1.0 / 3) < 1e-6 for f in done_fracs)


# --- vram ------------------------------------------------------------------


def _cpu_only():
    return VRAMManager(devices=[Device("CPU", "cpu", 16.0)])


def _small_gpu():
    return VRAMManager(devices=[Device("TestGPU", "cuda", 6.0), Device("CPU", "cpu", 32.0)])


def test_vram_fits_on_gpu():
    m = _small_gpu()
    r = m.reserve("model-a", fp32_gb=4.0)
    assert r.reservation.device.kind == "cuda"
    assert not r.fell_back_to_cpu


def test_vram_downgrades_precision_then_falls_back():
    m = _small_gpu()
    m.reserve("resident", fp32_gb=3.0)  # occupies part of the 6 GB
    r = m.reserve("big", fp32_gb=5.5, supports_fp16=True, fp16_gb=3.0)
    # Can't fit fp32 in remaining ~3 GB; should downgrade or fall back, never OOM.
    assert r.downgrades  # some ladder step was taken
    assert r.reservation.gb <= m.devices[0].total_gb


def test_vram_cpu_only_always_admits():
    m = _cpu_only()
    r = m.reserve("x", fp32_gb=99.0)
    assert r.reservation.device.kind == "cpu"


def test_vram_flush_and_ttl_eviction():
    m = _cpu_only()
    m.reserve("keep-me", fp32_gb=1.0)
    m.warm_pool_ttl_s = 0.01
    m._touched_at["keep-me"] = 0.0  # long ago
    assert m.evict_expired() == ["keep-me"]
    assert m.resident_models() == []

    m.reserve("a", fp32_gb=1.0)
    m.reserve("b", fp32_gb=1.0)
    assert set(m.flush()) == {"a", "b"}
    assert m.resident_models() == []
