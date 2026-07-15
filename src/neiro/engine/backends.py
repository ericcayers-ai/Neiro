"""Hardware backend probing (roadmap §9 / §11)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BackendInfo:
    id: str
    available: bool
    detail: str = ""
    throughput_hint: str = ""


@dataclass
class DeviceLadder:
    backends: list[BackendInfo] = field(default_factory=list)

    def preferred(self) -> BackendInfo:
        for b in self.backends:
            if b.available:
                return b
        return BackendInfo(id="cpu", available=True, detail="numpy/scipy DSP floor")


def probe_backends() -> DeviceLadder:
    backends: list[BackendInfo] = []

    # CUDA
    try:
        import torch

        cuda = bool(torch.cuda.is_available())
        detail = torch.cuda.get_device_name(0) if cuda else "torch present, CUDA unavailable"
        backends.append(BackendInfo("cuda", cuda, detail, "high" if cuda else "n/a"))
    except Exception:
        backends.append(BackendInfo("cuda", False, "torch not installed"))

    # DirectML (Windows)
    try:
        import torch_directml  # type: ignore

        backends.append(
            BackendInfo("directml", True, f"device={torch_directml.device()}", "medium")
        )
    except Exception:
        backends.append(BackendInfo("directml", False, "torch-directml not installed"))

    # ONNX Runtime
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        backends.append(BackendInfo("onnxruntime", True, f"providers={providers}", "medium"))
    except Exception:
        backends.append(BackendInfo("onnxruntime", False, "onnxruntime not installed"))

    # MPS (Apple)
    try:
        import torch

        mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
        backends.append(BackendInfo("mps", mps, "Apple Metal" if mps else "unavailable"))
    except Exception:
        backends.append(BackendInfo("mps", False, "torch not installed"))

    backends.append(BackendInfo("cpu", True, "always available", "baseline"))
    return DeviceLadder(backends=backends)


def should_compile() -> bool:
    """Return True when torch.compile is available and user has not disabled it."""
    import os

    if os.environ.get("NEIRO_TORCH_COMPILE", "1") in ("0", "false", "False"):
        return False
    try:
        import torch

        return hasattr(torch, "compile")
    except Exception:
        return False
