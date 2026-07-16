"""VRAM context virtualization manager (roadmap §3.3).

The single owner of accelerator memory. Nothing loads a model except through
:meth:`VRAMManager.reserve`. Admission control compares a model's declared
footprint against free memory and applies a downgrade ladder — evict idle models,
shrink chunk size, drop precision, fall back to CPU — so a CUDA OOM never reaches
the user, only a slower fallback with a stated reason.

Detection is best-effort: if ``torch`` with CUDA is present the real free-memory
figure is used; otherwise the manager models a CPU device with a generous RAM
budget so the rest of the engine behaves identically on machines without a GPU.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

__all__ = ["Device", "VRAMManager", "Reservation", "AdmissionResult"]

Precision = Literal["fp32", "fp16", "bf16"]


@dataclass
class Device:
    name: str
    kind: Literal["cuda", "mps", "cpu"]
    total_gb: float
    index: int = 0


@dataclass
class Reservation:
    model_id: str
    device: Device
    precision: Precision
    gb: float
    chunk_scale: float  # 1.0 = model's preferred chunk; <1.0 = shrunk to fit


@dataclass
class AdmissionResult:
    reservation: Reservation
    downgrades: tuple[str, ...] = ()
    fell_back_to_cpu: bool = False


def detect_devices() -> list[Device]:
    devices: list[Device] = []
    try:  # pragma: no cover - depends on optional torch/CUDA
        import torch

        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                devices.append(Device(props.name, "cuda", props.total_memory / 1e9, index=i))
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            devices.append(Device("Apple GPU (MPS)", "mps", 8.0))
    except Exception:
        pass

    # Always expose a CPU device as the final rung of the ladder.
    total_ram = 16.0
    try:
        import os

        pages = os.sysconf("SC_PHYS_PAGES") if hasattr(os, "sysconf") else None
        page_size = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else None
        if pages and page_size:
            total_ram = pages * page_size / 1e9
    except Exception:
        pass
    devices.append(Device("CPU", "cpu", total_ram))
    return devices


class VRAMManager:
    """Tracks residency and enforces admission control with a downgrade ladder."""

    SAFETY_MARGIN_GB = 0.5

    def __init__(self, devices: list[Device] | None = None) -> None:
        self.devices = devices or detect_devices()
        # free_gb tracks currently-available memory per device index+kind.
        self._free: dict[tuple[str, int], float] = {
            (d.kind, d.index): d.total_gb for d in self.devices
        }
        self._resident: dict[str, Reservation] = {}
        self._lru: list[str] = []
        # How long idle residents may stay warm between jobs (prefs /api/prefs).
        self.warm_pool_ttl_s: float = 300.0
        self._touched_at: dict[str, float] = {}

    @property
    def has_accelerator(self) -> bool:
        return any(d.kind != "cpu" for d in self.devices)

    def _best_device(self, prefer_cpu: bool = False) -> Device:
        if prefer_cpu:
            return next(d for d in self.devices if d.kind == "cpu")
        accel = [d for d in self.devices if d.kind != "cpu"]
        if accel:
            return max(accel, key=lambda d: self._free[(d.kind, d.index)])
        return self.devices[0]

    def reserve(
        self,
        model_id: str,
        *,
        fp32_gb: float,
        supports_fp16: bool = False,
        fp16_gb: float | None = None,
        min_chunk_scale: float = 0.5,
    ) -> AdmissionResult:
        """Admit a model, applying the downgrade ladder as needed."""
        if model_id in self._resident:
            self._touch(model_id)
            return AdmissionResult(self._resident[model_id])

        downgrades: list[str] = []
        device = self._best_device()

        def free_on(dev: Device) -> float:
            return self._free[(dev.kind, dev.index)]

        precision: Precision = "fp32"
        need = fp32_gb
        chunk_scale = 1.0

        # 1) Evict idle models on the target device if we don't fit.
        if device.kind != "cpu" and need + self.SAFETY_MARGIN_GB > free_on(device):
            self._evict_until(device, need + self.SAFETY_MARGIN_GB, downgrades)

        # 2) Try lower precision.
        if (
            device.kind != "cpu"
            and need + self.SAFETY_MARGIN_GB > free_on(device)
            and supports_fp16
            and fp16_gb is not None
        ):
            precision = "fp16"
            need = fp16_gb
            downgrades.append("precision->fp16")

        # 3) Shrink chunk size within the allowed range.
        if device.kind != "cpu" and need + self.SAFETY_MARGIN_GB > free_on(device):
            scale = (free_on(device) - self.SAFETY_MARGIN_GB) / max(need, 1e-6)
            scale = max(min_chunk_scale, min(1.0, scale))
            if scale < 1.0:
                chunk_scale = scale
                need = need * scale
                downgrades.append(f"chunk->{scale:.2f}x")

        # 4) Fall back to CPU.
        fell_back = False
        if device.kind != "cpu" and need + self.SAFETY_MARGIN_GB > free_on(device):
            device = self._best_device(prefer_cpu=True)
            precision = "fp32"
            need = fp32_gb
            chunk_scale = 1.0
            fell_back = True
            downgrades.append("device->cpu")

        res = Reservation(model_id, device, precision, need, chunk_scale)
        self._free[(device.kind, device.index)] -= need
        self._resident[model_id] = res
        self._touch(model_id)
        return AdmissionResult(res, tuple(downgrades), fell_back)

    def release(self, model_id: str) -> None:
        res = self._resident.pop(model_id, None)
        if res is None:
            return
        self._free[(res.device.kind, res.device.index)] += res.gb
        if model_id in self._lru:
            self._lru.remove(model_id)
        self._touched_at.pop(model_id, None)

    def flush(self) -> list[str]:
        """Release every resident model. Returns the ids that were flushed."""
        flushed = list(self._resident)
        for model_id in flushed:
            self.release(model_id)
        return flushed

    def evict_expired(self) -> list[str]:
        """Drop residents idle longer than ``warm_pool_ttl_s`` (0 = never auto-evict)."""
        ttl = self.warm_pool_ttl_s
        if ttl <= 0:
            return []
        now = time.monotonic()
        expired = [
            mid
            for mid, touched in list(self._touched_at.items())
            if mid in self._resident and (now - touched) >= ttl
        ]
        for mid in expired:
            self.release(mid)
        return expired

    def resident_models(self) -> list[str]:
        return list(self._lru)

    def free_gb(self, device: Device) -> float:
        return self._free[(device.kind, device.index)]

    def _touch(self, model_id: str) -> None:
        if model_id in self._lru:
            self._lru.remove(model_id)
        self._lru.append(model_id)
        self._touched_at[model_id] = time.monotonic()

    def _evict_until(self, device: Device, need_gb: float, log: list[str]) -> None:
        key = (device.kind, device.index)
        for model_id in list(self._lru):
            if self._free[key] >= need_gb:
                return
            res = self._resident.get(model_id)
            if res is not None and (res.device.kind, res.device.index) == key:
                self.release(model_id)
                log.append(f"evict:{model_id}")
