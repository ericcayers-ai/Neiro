"""Optional Transkun-class piano adapter (Yan, semi-Markov CRF piano transcription).

`transkun <https://github.com/Yujia-Yan/Transkun>`_'s stable public surface is
its console script (``transkun in.wav out.mid``); its in-process Python module
path has moved between releases (``transkun.ModelTransformer`` in some,
different internals in others). Rather than pin to an internal path that
breaks silently on upgrade, this adapter shells out to the installed console
script — the same "adapt to the upstream package's real interface" pattern
:mod:`neiro.adapters.piano_transcription_adapter` uses for its checkpoint
fetch — and reads the resulting MIDI back with
:func:`neiro.symbolic.midi.read_midi_notes`. The manifest's ``requires:
["transkun"]`` still gates availability on the pip package being importable.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import soundfile as sf

from neiro.engine.artifacts import AudioTensor, NoteStream
from neiro.nodes.base import ModelProfile
from neiro.util import subprocess_win

__all__ = ["TranskunPianoAdapter"]


class TranskunPianoAdapter:
    def __init__(
        self,
        model_id: str = "transkun-piano",
        weight_path: str | None = None,
        track: str = "piano",
        device: str = "cpu",
        **_: object,
    ) -> None:
        self.weight_path = weight_path
        self.track = track
        self.device = device
        self._binary: str | None = None
        self.profile = ModelProfile(
            model_id=model_id,
            task="transcribe",
            fp32_gb=0.8,
            sample_rate=44100,
            channels=1,
            quality_class="reference",
            license_spdx="unknown",
            extras={
                "polyphony": "polyphonic (piano-specific)",
                "backend": "transkun CLI (semi-Markov CRF)",
                "license_note": "verify upstream license before commercial use",
            },
        )

    def load(self, device: str, precision: str) -> None:
        self.device = device
        binary = shutil.which("transkun")
        if binary is None:
            raise RuntimeError(
                "transkun is importable but its console script isn't on PATH; "
                "reinstall with 'pip install transkun' in this environment"
            )
        self._binary = binary

    def transcribe(self, audio: AudioTensor) -> NoteStream:
        from neiro.symbolic.midi import read_midi_notes

        if self._binary is None:
            self.load(self.device, "fp32")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "in.wav"
            mid = Path(tmp) / "out.mid"
            sf.write(str(wav), audio.to_mono().samples.T, audio.sample_rate)
            cmd = [self._binary, str(wav), str(mid)]
            if self.device == "cuda":
                cmd += ["--device", "cuda"]
            if self.weight_path:
                cmd += ["--weight", self.weight_path]
            result = subprocess_win.run(cmd, capture_output=True, timeout=600, check=False)
            if result.returncode != 0 or not mid.is_file():
                raise RuntimeError(
                    f"transkun failed (exit {result.returncode}): "
                    f"{result.stderr.decode(errors='replace')[:500]}"
                )
            stream = read_midi_notes(mid, track=self.track)
        return NoteStream(stream.events, source=self.profile.model_id)

    def unload(self) -> None:
        self._binary = None
