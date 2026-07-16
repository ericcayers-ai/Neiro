"""Optional CLAP zero-shot analyzer adapter.

The adapter is intentionally import-light: a fresh Neiro install can register
the analyze manifest and still run, while machines with ``neiro[clap]`` installed
get LAION-CLAP zero-shot instrument tags.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from neiro.engine.artifacts import AudioTensor

DEFAULT_LABELS = (
    "vocals",
    "drums",
    "bass",
    "electric guitar",
    "acoustic guitar",
    "piano",
    "keys",
    "synthesizer",
    "strings",
    "brass",
    "woodwinds",
    "choir",
    "percussion",
    "orchestra",
    "spoken voice",
)


class CLAPAnalyzeAdapter:
    """Analyze/tag interface backed by LAION-CLAP when available."""

    def __init__(
        self,
        model_id: str = "an-clap",
        labels: Iterable[str] | None = None,
        top_k: int = 6,
        threshold: float = 0.08,
        asserted_threshold: float = 0.22,
        sample_rate: int = 48_000,
        amodel: str = "HTSAT-base",
        enable_fusion: bool = False,
    ) -> None:
        self.model_id = model_id
        self.labels = tuple(labels or DEFAULT_LABELS)
        self.top_k = int(top_k)
        self.threshold = float(threshold)
        self.asserted_threshold = float(asserted_threshold)
        self.sample_rate = int(sample_rate)
        self.amodel = amodel
        self.enable_fusion = bool(enable_fusion)
        self._model = None
        self._text_embeddings: np.ndarray | None = None

    def load(self, device: str = "cpu", precision: str = "fp32"):
        if self._model is not None:
            return self._model
        try:
            import laion_clap
        except Exception:
            return None

        try:
            model = laion_clap.CLAP_Module(
                enable_fusion=self.enable_fusion,
                amodel=self.amodel,
                device=device,
            )
        except TypeError:
            model = laion_clap.CLAP_Module(enable_fusion=self.enable_fusion, amodel=self.amodel)
        try:
            model.load_ckpt()
        except TypeError:
            model.load_ckpt(model_id=1)
        self._model = model
        self._text_embeddings = None
        return model

    def unload(self) -> None:
        self._model = None
        self._text_embeddings = None

    def analyze(self, audio: AudioTensor) -> tuple[dict, ...]:
        return self.tag(audio)

    def tag(self, audio: AudioTensor) -> tuple[dict, ...]:
        model = self.load("cpu", "fp32")
        if model is None or not self.labels:
            return ()
        try:
            audio_embedding = self._audio_embedding(model, audio)
            text_embeddings = self._label_embeddings(model)
            scores = self._cosine_scores(audio_embedding, text_embeddings)
        except Exception:
            return ()

        if scores.size == 0:
            return ()
        ranked = np.argsort(scores)[::-1][: max(1, self.top_k)]
        tags: list[dict] = []
        for idx in ranked:
            confidence = float(scores[idx])
            if confidence < self.threshold:
                continue
            tags.append(
                {
                    "instrument": self.labels[int(idx)],
                    "confidence": round(confidence, 3),
                    "status": (
                        "asserted" if confidence >= self.asserted_threshold else "tentative"
                    ),
                }
            )
        return tuple(tags)

    def _label_embeddings(self, model) -> np.ndarray:
        if self._text_embeddings is not None:
            return self._text_embeddings
        prompts = [f"a recording containing {label}" for label in self.labels]
        try:
            embeddings = model.get_text_embedding(prompts, use_tensor=False)
        except TypeError:
            embeddings = model.get_text_embedding(prompts)
        self._text_embeddings = _as_2d(embeddings)
        return self._text_embeddings

    def _audio_embedding(self, model, audio: AudioTensor) -> np.ndarray:
        samples = _resample_mono(audio, self.sample_rate)
        for payload in (samples, [samples], samples[np.newaxis, :]):
            try:
                return _as_2d(model.get_audio_embedding_from_data(x=payload, use_tensor=False))
            except TypeError:
                try:
                    return _as_2d(model.get_audio_embedding_from_data(payload, use_tensor=False))
                except TypeError:
                    continue
            except Exception:
                continue
        raise RuntimeError("laion_clap could not embed audio data")

    @staticmethod
    def _cosine_scores(audio_embedding: np.ndarray, text_embeddings: np.ndarray) -> np.ndarray:
        audio_vec = np.asarray(audio_embedding[0], dtype=np.float64)
        text = np.asarray(text_embeddings, dtype=np.float64)
        audio_vec /= np.linalg.norm(audio_vec) + 1e-12
        text /= np.linalg.norm(text, axis=1, keepdims=True) + 1e-12
        sims = text @ audio_vec
        logits = sims - np.max(sims)
        probs = np.exp(logits)
        return probs / (np.sum(probs) + 1e-12)


def _as_2d(value) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32)
    if array.ndim == 1:
        array = array[np.newaxis, :]
    if array.ndim > 2:
        array = array.reshape(array.shape[0], -1)
    return array


def _resample_mono(audio: AudioTensor, target_rate: int) -> np.ndarray:
    mono = audio.samples.mean(axis=0).astype(np.float32)
    if audio.sample_rate == target_rate:
        return mono
    try:
        from math import gcd

        from scipy.signal import resample_poly

        div = gcd(audio.sample_rate, target_rate)
        return resample_poly(mono, target_rate // div, audio.sample_rate // div).astype(np.float32)
    except Exception:
        duration = audio.duration_seconds
        n = max(1, int(duration * target_rate))
        src = np.linspace(0.0, duration, num=mono.size, endpoint=False)
        dst = np.linspace(0.0, duration, num=n, endpoint=False)
        return np.interp(dst, src, mono).astype(np.float32)
