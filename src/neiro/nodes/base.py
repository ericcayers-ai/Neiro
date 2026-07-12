"""Model adapter protocols (roadmap §10.1).

Every neural network — vendored, community, or user-supplied — is wrapped in one
of these rigid interfaces. The engine never sees a model repository's internals;
it sees a ``Separator`` / ``Analyzer`` / ``Transcriber`` / ``Enhancer``. Adapters
are constructed by the registry from a manifest and may lazily import heavy deps
only inside :meth:`load`, so importing this module never pulls in torch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from neiro.engine.artifacts import AnalysisReport, AudioTensor, NoteStream

__all__ = [
    "ModelProfile",
    "Separator",
    "Analyzer",
    "Transcriber",
    "Enhancer",
]


@dataclass
class ModelProfile:
    """Static description used by the VRAM manager and planner."""

    model_id: str
    task: str
    stems: tuple[str, ...] = ()
    fp32_gb: float = 0.0
    fp16_gb: float | None = None
    supports_fp16: bool = False
    sample_rate: int = 44100
    channels: int = 2
    chunk_seconds: float = 8.0
    overlap: float = 0.25
    quality_class: str = "standard"  # draft | standard | reference
    license_spdx: str = "unknown"
    extras: dict = field(default_factory=dict)


@runtime_checkable
class Separator(Protocol):
    profile: ModelProfile

    def load(self, device: str, precision: str) -> None: ...

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        """Return a mapping of stem name -> audio, aligned to the input length."""
        ...

    def unload(self) -> None: ...


@runtime_checkable
class Analyzer(Protocol):
    profile: ModelProfile

    def analyze(self, audio: AudioTensor) -> AnalysisReport: ...


@runtime_checkable
class Transcriber(Protocol):
    profile: ModelProfile

    def load(self, device: str, precision: str) -> None: ...

    def transcribe(self, audio: AudioTensor) -> NoteStream: ...

    def unload(self) -> None: ...


@runtime_checkable
class Enhancer(Protocol):
    profile: ModelProfile

    def load(self, device: str, precision: str) -> None: ...

    def enhance(self, audio: AudioTensor) -> AudioTensor: ...

    def unload(self) -> None: ...
