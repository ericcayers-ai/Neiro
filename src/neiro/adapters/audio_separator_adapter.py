"""Generic wrapper around the ``audio-separator`` package (pip: ``audio-separator``).

This one adapter covers a large slice of the roadmap's separation model zoo
(§5.1) because the upstream package already bundles and auto-downloads BS-RoFormer,
Mel-RoFormer, MDX23C, HTDemucs, and VR-Arch checkpoints trained by the UVR
project — rather than reimplementing any of that inference code, each named
model becomes a manifest that parametrizes this one class with a
``model_filename``. Verified against the installed package (v0.44.3): the real
constructor/method signatures are inspected directly, not assumed from docs.

The package's own ``Separator.load_model`` performs the actual download+cache
(to whatever ``model_file_dir`` we hand it — we point this at Neiro's unified
models directory so it participates in the same download-management story as
every other model, see :mod:`neiro.engine.registry`).

Two task shapes share this module:

* :class:`AudioSeparatorModel` — ``Separator`` protocol; returns every stem the
  model produces (vocals/instrumental, drum-kit pieces, karaoke leads, …).
* :class:`AudioSeparatorEnhancer` — ``Enhancer`` protocol; the same underlying
  call, but returns a single named stem (e.g. the denoised or dereverbed
  signal) — used for the package's denoise/dereverb models under the
  restoration node family (roadmap §6).

Both parse ``separate()``'s output filenames, which follow the pattern
``{input}_({StemLabel})_{model}.wav``; the manifest supplies ``stem_labels``
mapping the library's label text to Neiro's canonical stem names, so no
model-specific parsing logic lives in this file.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

import soundfile as sf

from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile

__all__ = ["AudioSeparatorModel", "AudioSeparatorEnhancer"]

_LABEL_RE = re.compile(r"\(([^)]+)\)")

# Mel/BS-RoFormer backends in audio-separator crash on very short clips
# (tensor length mismatch in overlap-add). Pad below this floor, then crop.
_MIN_INFER_SECONDS = 10.0


def _normalize_label(label: str) -> str:
    return label.strip().lower().replace(" ", "_").replace("-", "_")


def _crop_or_pad(samples, frames: int):
    import numpy as np

    if samples.shape[-1] == frames:
        return samples
    if samples.shape[-1] > frames:
        return samples[..., :frames]
    pad = np.zeros(samples.shape[:-1] + (frames - samples.shape[-1],), dtype=samples.dtype)
    return np.concatenate([samples, pad], axis=-1)


class _AudioSeparatorBase:
    def __init__(
        self,
        model_id: str,
        model_filename: str,
        stem_labels: dict[str, str],
        *,
        task: str,
        stems: tuple[str, ...] = (),
        quality_class: str = "reference",
        license_spdx: str = "unknown",
        license_note: str = "",
        model_file_dir: str | None = None,
        **_: object,
    ) -> None:
        self.model_filename = model_filename
        # Map normalized upstream label -> our canonical stem name.
        self._label_to_stem = {_normalize_label(v): k for k, v in stem_labels.items()}
        self._model_file_dir = model_file_dir
        self._separator = None
        self.profile = ModelProfile(
            model_id=model_id,
            task=task,
            stems=stems,
            fp32_gb=2.5,
            sample_rate=44100,
            quality_class=quality_class,
            license_spdx=license_spdx,
            extras={
                "backend": "audio-separator",
                "model_filename": model_filename,
                "license_note": license_note,
            },
        )

    def load(self, device: str, precision: str) -> None:
        from audio_separator.separator import Separator

        self._separator = Separator(
            log_level=40,  # ERROR — the library is chatty at default INFO level
            model_file_dir=self._model_file_dir or "/tmp/audio-separator-models/",
            output_format="WAV",
            sample_rate=self.profile.sample_rate,
            # Avoid RoFormer segment-size mismatches on odd/short lengths.
            mdxc_params={
                "segment_size": 256,
                "override_model_segment_size": True,
                "batch_size": 1,
                "overlap": 8,
                "pitch_shift": 0,
            },
        )
        self._separator.load_model(model_filename=self.model_filename)

    def unload(self) -> None:
        self._separator = None

    def _run(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        import numpy as np

        if self._separator is None:
            self.load("cpu", "fp32")

        target_frames = audio.frames
        samples = audio.samples
        min_frames = int(_MIN_INFER_SECONDS * audio.sample_rate)
        if target_frames < min_frames:
            pad = np.zeros(
                (samples.shape[0], min_frames - target_frames), dtype=samples.dtype
            )
            samples = np.concatenate([samples, pad], axis=1)

        with tempfile.TemporaryDirectory() as tmp:
            in_path = Path(tmp) / "input.wav"
            sf.write(str(in_path), samples.T, audio.sample_rate)
            self._separator.output_dir = tmp
            output_names = self._separator.separate(str(in_path))

            results: dict[str, AudioTensor] = {}
            for name in output_names:
                path = Path(tmp) / name
                if not path.is_file():
                    path = Path(name)  # some versions return absolute paths
                match = _LABEL_RE.search(name)
                raw_label = match.group(1) if match else name
                stem = self._label_to_stem.get(
                    _normalize_label(raw_label), _normalize_label(raw_label)
                )
                data, sr = sf.read(str(path), dtype="float32", always_2d=True)
                cropped = _crop_or_pad(data.T.copy(), target_frames)
                results[stem] = AudioTensor(cropped, sr).with_provenance(
                    f"audio-separator:{self.model_filename}"
                )
        return results



class AudioSeparatorModel(_AudioSeparatorBase):
    """``Separator`` protocol adapter — returns every stem the model produces."""

    def __init__(
        self,
        model_id: str,
        model_filename: str,
        stems: list[str],
        stem_labels: dict[str, str],
        **kw: object,
    ) -> None:
        super().__init__(
            model_id, model_filename, stem_labels, task="separate", stems=tuple(stems), **kw
        )

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        return self._run(audio)


class AudioSeparatorEnhancer(_AudioSeparatorBase):
    """``Enhancer`` protocol adapter — returns the single target (repaired) stem."""

    def __init__(
        self,
        model_id: str,
        model_filename: str,
        stem_labels: dict[str, str],
        target_stem: str,
        **kw: object,
    ) -> None:
        super().__init__(
            model_id,
            model_filename,
            stem_labels,
            task="enhance",
            stems=(target_stem,),
            **kw,
        )
        self.target_stem = target_stem

    def enhance(self, audio: AudioTensor) -> AudioTensor:
        stems = self._run(audio)
        if self.target_stem in stems:
            return stems[self.target_stem]
        if stems:
            # Fall back to whichever stem the label map produced, if the upstream
            # label text drifts across a package update.
            return next(iter(stems.values()))
        # The backend produced no output (e.g. an input too short for the
        # model's fixed window). Surface a clear error rather than crashing on
        # an empty iterator deep in a chain.
        raise RuntimeError(
            f"{self.profile.model_id}: model produced no output for this input "
            "(it may be too short for the model's required window)"
        )
