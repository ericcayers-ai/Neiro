"""Concrete graph nodes for the audio pipeline (roadmap §3–§5).

These wrap ingest, lane creation, analysis, separation, and the residual/null-test
into :class:`~neiro.engine.graph.Node` objects the DAG runtime can schedule and
cache. Separation runs through the VRAM manager: the node reserves the model
(applying the downgrade ladder), runs it, then releases.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from neiro.engine.artifacts import Artifact, AudioTensor
from neiro.engine.graph import Node, ExecutionContext
from neiro.engine.vram import VRAMManager
from neiro.dsp import residual as dsp_residual
from neiro.analysis import analyze as run_analysis

__all__ = [
    "IngestNode",
    "LaneNode",
    "AnalyzeNode",
    "SeparateNode",
    "ResidualNode",
]


class IngestNode(Node):
    def __init__(self, node_id: str, path: str | Path):
        super().__init__(node_id)
        self.path = str(path)

    def config_repr(self) -> str:
        return f"Ingest({self.path})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.io import load_audio

        ctx.report(self.node_id, "decode", 0.1, f"reading {Path(self.path).name}")
        audio = load_audio(self.path)
        return {"audio": audio}


class LaneNode(Node):
    def __init__(self, node_id: str, source: tuple[str, str], target_sr: int, mono: bool = False):
        super().__init__(node_id, inputs={"audio": source})
        self.target_sr = target_sr
        self.mono = mono

    def config_repr(self) -> str:
        return f"Lane(sr={self.target_sr},mono={self.mono})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.io import make_lane

        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        return {"audio": make_lane(audio, self.target_sr, mono=self.mono)}


class AnalyzeNode(Node):
    def __init__(self, node_id: str, source: tuple[str, str]):
        super().__init__(node_id, inputs={"audio": source})

    def config_repr(self) -> str:
        return "Analyze(v1)"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        ctx.report(self.node_id, "analyze", 0.5, "measuring tempo, key, loudness")
        return {"report": run_analysis(audio)}


class SeparateNode(Node):
    """Runs a Separator adapter, emitting one output port per stem."""

    def __init__(
        self,
        node_id: str,
        source: tuple[str, str],
        separator: Any,
        vram: VRAMManager,
    ):
        super().__init__(node_id, inputs={"audio": source})
        self.separator = separator
        self.vram = vram

    def config_repr(self) -> str:
        p = self.separator.profile
        return f"Separate({p.model_id},stems={','.join(p.stems)})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        profile = self.separator.profile

        admission = self.vram.reserve(
            profile.model_id,
            fp32_gb=profile.fp32_gb,
            supports_fp16=profile.supports_fp16,
            fp16_gb=profile.fp16_gb,
        )
        res = admission.reservation
        if admission.downgrades:
            ctx.report(
                self.node_id,
                "admission",
                0.05,
                f"{profile.model_id}: {', '.join(admission.downgrades)} "
                f"-> {res.device.name} ({res.precision})",
            )
        try:
            self.separator.load(res.device.kind, res.precision)
            ctx.report(self.node_id, "separate", 0.3, f"running {profile.model_id}")
            stems = self.separator.separate(audio)
        finally:
            self.separator.unload()
            self.vram.release(profile.model_id)

        return {name: stem for name, stem in stems.items()}


class ResidualNode(Node):
    """Computes source - sum(stems): the 'everything else' track and null test."""

    def __init__(self, node_id: str, source: tuple[str, str], stems: dict[str, tuple[str, str]]):
        inputs = {"__source__": source}
        inputs.update({f"stem_{k}": v for k, v in stems.items()})
        super().__init__(node_id, inputs=inputs)

    def config_repr(self) -> str:
        return "Residual(v1)"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        source = inputs["__source__"]
        assert isinstance(source, AudioTensor)
        stem_arrays = [
            art.samples
            for name, art in inputs.items()
            if name != "__source__" and isinstance(art, AudioTensor)
        ]
        resid = dsp_residual(source.samples, stem_arrays)
        art = AudioTensor(resid, source.sample_rate).with_provenance("residual")
        return {"residual": art}
