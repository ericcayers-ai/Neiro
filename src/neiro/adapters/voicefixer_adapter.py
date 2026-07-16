"""VoiceFixer vocal restoration (roadmap §6.1 "VoiceFixer / Resemble-Enhance").

Wraps the installable ``voicefixer`` package
(https://github.com/haoheliu/voicefixer). Weights download on first use via
the upstream package; Neiro does not redistribute them.
"""

from __future__ import annotations

import numpy as np

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["VoiceFixerRestorer"]


class VoiceFixerRestorer:
    def __init__(self, model_id: str = "voicefixer", mode: int = 0, **_: object) -> None:
        self.mode = mode
        self._vf = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="enhance",
            fp32_gb=1.5,
            sample_rate=44100,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "fixes": "damaged vocal stems / speech restoration",
                "backend": "voicefixer",
                "license_note": "verify VoiceFixer upstream license before commercial use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        try:
            from voicefixer import VoiceFixer  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                f"{self.profile.model_id}: VoiceFixer is not installed. "
                "Install with `pip install voicefixer` (or `neiro[voicefixer]`)."
            ) from exc
        self._vf = VoiceFixer()

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        import tempfile
        from pathlib import Path

        import soundfile as sf

        if self._vf is None:
            self.load("cpu", "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            inp = Path(tmp) / "in.wav"
            out = Path(tmp) / "out.wav"
            sf.write(str(inp), audio.to_mono().samples.T, audio.sample_rate)
            self._vf.restore(input=str(inp), output=str(out), cuda=False, mode=self.mode)
            data, sr = sf.read(str(out), dtype="float32", always_2d=True)
        return AudioTensor(np.asarray(data.T, dtype=np.float32), int(sr)).with_provenance(
            self.profile.model_id
        )

    def unload(self) -> None:
        self._vf = None
