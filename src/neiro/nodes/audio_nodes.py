"""Concrete graph nodes for the audio pipeline (roadmap §3–§5).

These wrap ingest, lane creation, analysis, separation, and the residual/null-test
into :class:`~neiro.engine.graph.Node` objects the DAG runtime can schedule and
cache. Separation runs through the VRAM manager: the node reserves the model
(applying the downgrade ladder), runs it, then releases.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from neiro.analysis import analyze as run_analysis
from neiro.dsp import residual as dsp_residual
from neiro.engine.artifacts import Artifact, AudioTensor
from neiro.engine.graph import ExecutionContext, Node
from neiro.engine.vram import VRAMManager

__all__ = [
    "IngestNode",
    "LaneNode",
    "AnalyzeNode",
    "SeparateNode",
    "ResidualNode",
    "EnhanceNode",
    "TranscribeNode",
    "CompileNode",
    "BleedSuppressNode",
    "GatherNode",
    "CascadeCenterNode",
    "CascadeHpssNode",
    "CascadeBandNode",
    "LyricsNode",
    "OrchestrateComposeNode",
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
        scale = getattr(self.separator, "_chunk_scale", 1.0)
        return f"Separate({p.model_id},stems={','.join(p.stems)},chunk={scale:.2f})"

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
        self.separator._chunk_scale = res.chunk_scale  # noqa: SLF001
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
            from neiro.dsp.chunking import separate_chunked
            from neiro.engine.estimator import timed_run

            def _run(chunk: AudioTensor) -> dict[str, AudioTensor]:
                return self.separator.separate(chunk)

            with timed_run(profile.model_id, res.device.kind, audio.duration_seconds):
                stems = separate_chunked(
                    _run,
                    audio,
                    chunk_seconds=profile.chunk_seconds,
                    overlap=profile.overlap,
                    chunk_scale=res.chunk_scale,
                )
        finally:
            self.separator.unload()
            self.vram.release(profile.model_id)

        # Each stem becomes an output port on this node.
        return dict(stems)


class EnhanceNode(Node):
    """Runs an Enhancer adapter: audio in, conditioned audio out (roadmap §6)."""

    def __init__(self, node_id: str, source: tuple[str, str], enhancer: Any, vram: VRAMManager):
        super().__init__(node_id, inputs={"audio": source})
        self.enhancer = enhancer
        self.vram = vram

    def config_repr(self) -> str:
        p = self.enhancer.profile
        return f"Enhance({p.model_id},{sorted(p.extras.items())})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        profile = self.enhancer.profile
        admission = self.vram.reserve(profile.model_id, fp32_gb=profile.fp32_gb)
        try:
            self.enhancer.load(admission.reservation.device.kind, admission.reservation.precision)
            ctx.report(self.node_id, "enhance", 0.3, f"running {profile.model_id}")
            out = self.enhancer.enhance(audio)
        finally:
            self.enhancer.unload()
            self.vram.release(profile.model_id)
        return {"audio": out}


class TranscribeNode(Node):
    """Runs a Transcriber adapter: audio in, NoteStream out (roadmap §7)."""

    def __init__(self, node_id: str, source: tuple[str, str], transcriber: Any, vram: VRAMManager):
        super().__init__(node_id, inputs={"audio": source})
        self.transcriber = transcriber
        self.vram = vram

    def config_repr(self) -> str:
        return f"Transcribe({self.transcriber.profile.model_id})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        profile = self.transcriber.profile
        admission = self.vram.reserve(profile.model_id, fp32_gb=profile.fp32_gb)
        try:
            self.transcriber.load(
                admission.reservation.device.kind, admission.reservation.precision
            )
            ctx.report(self.node_id, "transcribe", 0.3, f"running {profile.model_id}")
            notes = self.transcriber.transcribe(audio)
        finally:
            self.transcriber.unload()
            self.vram.release(profile.model_id)
        return {"notes": notes}


class CompileNode(Node):
    """Timeline compiler (roadmap §8.2): NoteStreams + analysis -> Timeline."""

    def __init__(
        self,
        node_id: str,
        streams: dict[str, tuple[str, str]],
        report: tuple[str, str] | None = None,
        *,
        quantize: bool = True,
        division: int = 4,
        strength: float = 1.0,
    ):
        inputs: dict[str, tuple[str, str]] = {f"stream_{k}": v for k, v in streams.items()}
        if report is not None:
            inputs["__report__"] = report
        super().__init__(node_id, inputs=inputs)
        self.quantize = quantize
        self.division = division
        self.strength = strength

    def config_repr(self) -> str:
        return f"Compile(q={self.quantize},div={self.division},s={self.strength})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.symbolic import compile_timeline

        bpm = None
        report = inputs.get("__report__")
        if report is not None and getattr(report, "estimated_bpm", None):
            bpm = float(report.estimated_bpm)
        named = {
            name.removeprefix("stream_"): art
            for name, art in inputs.items()
            if name != "__report__"
        }
        timeline = compile_timeline(
            named,
            bpm=bpm,
            quantize=self.quantize,
            division=self.division,
            strength=self.strength,
        )
        return {"timeline": timeline}


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


class GatherNode(Node):
    """Passes named upstream ports through as this node's own output ports.

    Lets a cascade (detect-all, cinematic, drums deep-dive — roadmap §5.5)
    whose stems come from several different nodes present a single "the
    stems are here" surface, so downstream code (CLI, UI, residual, cache)
    never needs to know whether a preset ran one model or a multi-step
    cascade.
    """

    def __init__(self, node_id: str, sources: dict[str, tuple[str, str]]):
        super().__init__(node_id, inputs=dict(sources))

    def config_repr(self) -> str:
        return "Gather(v1)"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        return dict(inputs)


class BleedSuppressNode(Node):
    """Post-pass adaptive-gain bleed suppression across separated stems (roadmap §5.3).

    Runs :func:`neiro.dsp.bleed.suppress_bleed_multi` on the full stem set. It
    is pure DSP (never gated on an optional model) so it can — and, per the
    planner's default, always does — run in every quality tier including
    Draft; the un-suppressed stems remain available upstream for an A/B
    comparison (roadmap principle 6).
    """

    def __init__(self, node_id: str, stems: dict[str, tuple[str, str]], *, strength: float = 0.6):
        super().__init__(node_id, inputs=dict(stems))
        self.strength = float(strength)

    def config_repr(self) -> str:
        return f"BleedSuppress(strength={self.strength:.2f})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.dsp.bleed import suppress_bleed_multi

        names = list(inputs)
        arrays: dict[str, Any] = {}
        sample_rate = 44100
        for name in names:
            art = inputs[name]
            assert isinstance(art, AudioTensor)
            arrays[name] = art.samples
            sample_rate = art.sample_rate
        ctx.report(self.node_id, "bleed", 0.5, f"suppressing bleed (strength={self.strength:.2f})")
        suppressed = suppress_bleed_multi(arrays, sample_rate, strength=self.strength)
        return {
            name: AudioTensor(arr, sample_rate).with_provenance(f"bleed:{self.strength:.2f}")
            for name, arr in suppressed.items()
        }


def _reserve_and_run(vram: VRAMManager, profile, fn):
    admission = vram.reserve(
        profile.model_id,
        fp32_gb=profile.fp32_gb,
        supports_fp16=profile.supports_fp16,
        fp16_gb=profile.fp16_gb,
    )
    try:
        return fn(admission.reservation)
    finally:
        vram.release(profile.model_id)


class CascadeCenterNode(Node):
    """Cascade step: extract a centre-panned target, pass the complement onward.

    Generic building block for detect-all / cinematic cascades (roadmap
    §5.5): any :class:`Separator` whose stems include ``"vocals"`` (a plain
    DSP center-extract, or a real neural vocals model) can serve as this
    step; the output ports are relabelled ``target_name``/``complement_name``
    so the same node class powers "vocals -> remainder" (detect-all) and
    "dialog -> remainder" (cinematic) alike.
    """

    def __init__(
        self,
        node_id: str,
        source: tuple[str, str],
        separator: Any,
        vram: VRAMManager,
        *,
        target_name: str = "vocals",
        complement_name: str = "remainder",
    ):
        super().__init__(node_id, inputs={"audio": source})
        self.separator = separator
        self.vram = vram
        self.target_name = target_name
        self.complement_name = complement_name

    def config_repr(self) -> str:
        return f"CascadeCenter({self.separator.profile.model_id},{self.target_name})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        profile = self.separator.profile

        def _do(reservation):
            self.separator.load(reservation.device.kind, reservation.precision)
            try:
                ctx.report(self.node_id, "cascade", 0.3, f"extracting {self.target_name}")
                return self.separator.separate(audio)
            finally:
                self.separator.unload()

        stems = _reserve_and_run(self.vram, profile, _do)
        target = stems.get("vocals") or next(iter(stems.values()))
        others = [v for k, v in stems.items() if k != "vocals"]
        if others:
            merged = others[0].samples.copy()
            for o in others[1:]:
                n = min(merged.shape[1], o.samples.shape[1])
                merged[:, :n] += o.samples[:, :n]
            complement = AudioTensor(merged, target.sample_rate)
        else:
            complement = audio
        return {
            self.target_name: target.with_provenance(f"cascade:{self.target_name}"),
            self.complement_name: complement.with_provenance(f"cascade:{self.complement_name}"),
        }


class CascadeHpssNode(Node):
    """Cascade step: harmonic/percussive split, relabelled for the cascade.

    Powers the "drums" step of detect-all (percussive -> drums, harmonic ->
    remainder) and the "fx" step of cinematic (percussive -> fx, harmonic ->
    music) with the same underlying DSP.
    """

    def __init__(
        self,
        node_id: str,
        source: tuple[str, str],
        *,
        target_name: str = "drums",
        complement_name: str = "remainder",
        kernel: int = 31,
    ):
        super().__init__(node_id, inputs={"audio": source})
        self.target_name = target_name
        self.complement_name = complement_name
        self.kernel = kernel

    def config_repr(self) -> str:
        return f"CascadeHpss({self.target_name},k={self.kernel})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.dsp import harmonic_percussive

        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        ctx.report(self.node_id, "cascade", 0.5, f"extracting {self.target_name} (HPSS)")
        harmonic, percussive = harmonic_percussive(
            audio.samples, audio.sample_rate, kernel=self.kernel
        )
        return {
            self.target_name: AudioTensor(percussive, audio.sample_rate).with_provenance(
                f"cascade:{self.target_name}"
            ),
            self.complement_name: AudioTensor(harmonic, audio.sample_rate).with_provenance(
                f"cascade:{self.complement_name}"
            ),
        }


class CascadeBandNode(Node):
    """Cascade step: low-pass band split (bass proxy), relabelled for the cascade."""

    def __init__(
        self,
        node_id: str,
        source: tuple[str, str],
        *,
        target_name: str = "bass",
        complement_name: str = "remainder",
        cutoff_hz: float = 220.0,
    ):
        super().__init__(node_id, inputs={"audio": source})
        self.target_name = target_name
        self.complement_name = complement_name
        self.cutoff_hz = cutoff_hz

    def config_repr(self) -> str:
        return f"CascadeBand({self.target_name},cutoff={self.cutoff_hz:.0f})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.dsp import band_extract

        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        ctx.report(self.node_id, "cascade", 0.5, f"extracting {self.target_name} (band)")
        low, high = band_extract(audio.samples, audio.sample_rate, cutoff_hz=self.cutoff_hz)
        return {
            self.target_name: AudioTensor(low, audio.sample_rate).with_provenance(
                f"cascade:{self.target_name}"
            ),
            self.complement_name: AudioTensor(high, audio.sample_rate).with_provenance(
                f"cascade:{self.complement_name}"
            ),
        }


class LyricsNode(Node):
    """Runs a Whisper-class lyrics adapter: audio in, LyricStream out (roadmap §8.2)."""

    def __init__(self, node_id: str, source: tuple[str, str], adapter: Any, vram: VRAMManager):
        super().__init__(node_id, inputs={"audio": source})
        self.adapter = adapter
        self.vram = vram

    def config_repr(self) -> str:
        return f"Lyrics({self.adapter.profile.model_id})"

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        audio = inputs["audio"]
        assert isinstance(audio, AudioTensor)
        profile = self.adapter.profile
        admission = self.vram.reserve(profile.model_id, fp32_gb=profile.fp32_gb)
        try:
            self.adapter.load(admission.reservation.device.kind, admission.reservation.precision)
            ctx.report(self.node_id, "lyrics", 0.3, f"running {profile.model_id}")
            lyrics = self.adapter.transcribe_lyrics(audio)
        finally:
            self.adapter.unload()
            self.vram.release(profile.model_id)
        return {"lyrics": lyrics}


class OrchestrateComposeNode(Node):
    """Auto-split orchestration compose step (roadmap §8.1): per-stem decodes
    (+ optional full-mix decode) -> one reconciled, quantized Timeline.

    Applies, in order: per-note provenance tagging, latency compensation,
    cross-stream dedup (bleed reconciliation), hybrid mix/stem voting, then
    the usual tempo-mapped quantization via :func:`neiro.symbolic.compile_timeline`.
    See :mod:`neiro.symbolic.orchestrate` for the algorithms themselves.
    """

    def __init__(
        self,
        node_id: str,
        stem_streams: dict[str, tuple[str, str]],
        model_ids: dict[str, str],
        *,
        mix_stream: tuple[str, str] | None = None,
        mix_model_id: str | None = None,
        report: tuple[str, str] | None = None,
        quantize: bool = True,
        division: int = 4,
        strength: float = 1.0,
    ):
        inputs: dict[str, tuple[str, str]] = {f"stem_{k}": v for k, v in stem_streams.items()}
        if mix_stream is not None:
            inputs["__mix__"] = mix_stream
        if report is not None:
            inputs["__report__"] = report
        super().__init__(node_id, inputs=inputs)
        self.model_ids = dict(model_ids)
        self.mix_model_id = mix_model_id
        self.quantize = quantize
        self.division = division
        self.strength = strength

    def config_repr(self) -> str:
        return (
            f"OrchestrateCompose(models={sorted(self.model_ids.items())},"
            f"mix={self.mix_model_id},q={self.quantize},div={self.division})"
        )

    def run(self, ctx: ExecutionContext, inputs: dict[str, Artifact]) -> dict[str, Artifact]:
        from neiro.symbolic import compile_timeline
        from neiro.symbolic.orchestrate import (
            compensate_latency,
            dedup_across_tracks,
            hybrid_merge_many,
            tag_provenance,
        )
        from neiro.symbolic.router import latency_for

        named: dict[str, Any] = {}
        for key, art in inputs.items():
            if not key.startswith("stem_"):
                continue
            instrument = key.removeprefix("stem_")
            model_id = self.model_ids.get(instrument, "")
            stream = compensate_latency(art, latency_for(model_id))
            stream = tag_provenance(stream, model_id)
            named[instrument] = stream
        ctx.report(self.node_id, "reconcile", 0.5, "cross-stream dedup")
        named = dedup_across_tracks(named)

        mix_art = inputs.get("__mix__")
        if mix_art is not None:
            mix_stream = compensate_latency(mix_art, latency_for(self.mix_model_id or ""))
            mix_stream = tag_provenance(mix_stream, self.mix_model_id or "")
            ctx.report(self.node_id, "hybrid", 0.7, "merging full-mix decode into stems")
            named = hybrid_merge_many(mix_stream, named)

        report = inputs.get("__report__")
        bpm = None
        if report is not None and getattr(report, "estimated_bpm", None):
            bpm = float(report.estimated_bpm)
        timeline = compile_timeline(
            named, bpm=bpm, quantize=self.quantize, division=self.division, strength=self.strength
        )
        return {"timeline": timeline}
