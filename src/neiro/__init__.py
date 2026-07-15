"""Neiro — local source separation, restoration, and symbolic transcription.

`neiro` (音色) is Japanese for *timbre* — the color of a sound. This package
implements the engine described in ``roadmap.md``: a typed-artifact DAG runtime
with a content-addressed cache, a VRAM-aware model registry, and a set of
processing nodes. The M0 milestone ships pure-DSP separation that requires no
model downloads; neural backends (Demucs, RoFormer, …) plug in through manifests.
"""

from __future__ import annotations

__version__ = "1.0.0"

from neiro.engine.artifacts import (
    AnalysisReport,
    Artifact,
    AudioTensor,
)
from neiro.engine.graph import Graph, Node, NodeResult

__all__ = [
    "__version__",
    "AudioTensor",
    "AnalysisReport",
    "Artifact",
    "Graph",
    "Node",
    "NodeResult",
]
