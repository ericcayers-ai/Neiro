"""Auto-split orchestration algorithms (roadmap §8.1 "Auto-Split Orchestration").

Pure functions over :class:`NoteStream` — no I/O, no adapters — so they're
cheap to unit test. The graph wiring that *produces* the streams these
operate on (cascade separation, per-stem decode) lives in
:mod:`neiro.engine.planner`, which imports this module.

Pipeline, in order:

1. :func:`tag_provenance` — stamp each note with the decoder id that produced it.
2. :func:`compensate_latency` — shift a stream back by a decoder's measured
   algorithmic latency (roadmap §8.1 "master clock").
3. :func:`dedup_across_tracks` — cross-stream reconciliation: the same note
   bleeding into two stems' decodes is kept only in the higher-confidence
   track (roadmap §8.1 "cross-stream reconciliation").
4. :func:`hybrid_merge` / :func:`hybrid_merge_many` — reconcile a full-mix
   decode against per-stem decodes: the stem wins on onset/pitch (it heard
   less masking); mix notes with no stem match are kept as fill-ins (the
   mix model heard something separation attenuated away), including notes
   an octave off from what the stem found (mix decoders confuse octaves more
   than the isolated stem's decoder does).
"""

from __future__ import annotations

from dataclasses import replace

from neiro.engine.artifacts import AudioTensor, NoteEvent, NoteStream

__all__ = [
    "tag_provenance",
    "compensate_latency",
    "calibrate_latency",
    "dedup_across_tracks",
    "hybrid_merge",
    "hybrid_merge_many",
    "normalize_instrument",
    "STEM_ALIASES",
]

# Analysis instrument names / user-typed instrument names -> the separation
# stem name that carries them. Anything not listed maps to itself.
STEM_ALIASES: dict[str, str] = {
    "keys": "piano",
    "keyboard": "piano",
    "organ": "piano",
    "electric guitar": "guitar",
    "acoustic guitar": "guitar",
    "lead vocal": "vocals",
    "percussion": "drums",
    "kit": "drums",
    "strings": "other",
    "winds": "other",
    "brass": "other",
    "saxophone": "other",
    "flute": "other",
}


def normalize_instrument(instrument: str) -> str:
    """Map an instrument label to the separation stem name that carries it."""
    key = instrument.strip().lower()
    return STEM_ALIASES.get(key, key)


def tag_provenance(stream: NoteStream, tag: str) -> NoteStream:
    """Stamp every event's ``provenance`` with ``tag`` (only where unset)."""
    if not tag:
        return stream
    events = tuple(e if e.provenance else replace(e, provenance=tag) for e in stream.events)
    return replace(stream, events=events)


def compensate_latency(stream: NoteStream, latency_seconds: float) -> NoteStream:
    """Shift onsets/offsets back by a decoder's measured algorithmic latency."""
    if not latency_seconds:
        return stream
    events = tuple(
        replace(
            e,
            onset=round(max(0.0, e.onset - latency_seconds), 6),
            offset=round(max(0.0, e.offset - latency_seconds), 6),
        )
        for e in stream.events
    )
    return replace(stream, events=events)


def calibrate_latency(
    transcriber,
    *,
    sample_rate: int = 16000,
    click_at: float = 1.0,
    duration: float = 2.5,
    burst_seconds: float = 0.01,
    burst_amplitude: float = 0.8,
) -> float:
    """Measure a transcriber's algorithmic latency via an impulse/click test.

    Synthesizes a short loud burst at ``click_at`` seconds, runs it through
    the transcriber, and returns ``max(0, detected_onset - click_at)``. Also
    writes the result into :data:`neiro.symbolic.router.LATENCY_SECONDS`
    keyed by the transcriber's model id, so subsequent decodes in this
    process compensate automatically. Returns ``0.0`` (no measurement, not an
    error) if the transcriber found nothing in the click — an honest "could
    not calibrate" rather than a fabricated number.
    """
    import numpy as np

    n = int(duration * sample_rate)
    x = np.zeros(n, dtype=np.float32)
    start = int(click_at * sample_rate)
    burst = max(1, int(burst_seconds * sample_rate))
    x[start : start + burst] = burst_amplitude
    audio = AudioTensor(x[None, :], sample_rate)

    transcriber.load("cpu", "fp32")
    try:
        stream = transcriber.transcribe(audio)
    finally:
        transcriber.unload()
    if not stream.events:
        return 0.0
    detected = min(e.onset for e in stream.events)
    latency = round(max(0.0, detected - click_at), 4)

    from neiro.symbolic.router import LATENCY_SECONDS

    model_id = getattr(getattr(transcriber, "profile", None), "model_id", None)
    if model_id:
        LATENCY_SECONDS[model_id] = latency
    return latency


def dedup_across_tracks(
    named_streams: dict[str, NoteStream], *, onset_tolerance: float = 0.03
) -> dict[str, NoteStream]:
    """Cross-stream reconciliation (roadmap §8.1): bleed duplicates keep one track.

    When the *same* pitch at (nearly) the same onset appears in more than one
    instrument's stream — a piano note bleeding into the guitar stem's decode
    — keep it only in the track whose note has the highest confidence, and
    drop it from the others. Distinct instruments playing distinct pitches at
    the same time are untouched; this only fires on true onset+pitch matches.
    """
    # Sweep all (track, index, event) triples ordered by (pitch, onset) — the
    # same chain-comparison approach as merge_streams, but tracking which
    # original track each event came from so the loser can be dropped from
    # its track rather than collapsing everything into one stream.
    indexed: list[tuple[str, int, NoteEvent]] = [
        (name, i, e) for name, stream in named_streams.items() for i, e in enumerate(stream.events)
    ]
    indexed.sort(key=lambda t: (t[2].pitch, t[2].onset))

    drop: set[tuple[str, int]] = set()
    last: tuple[str, int, NoteEvent] | None = None
    for name, i, e in indexed:
        if (
            last is not None
            and last[2].pitch == e.pitch
            and abs(last[2].onset - e.onset) <= onset_tolerance
        ):
            if e.confidence > last[2].confidence:
                drop.add((last[0], last[1]))
                last = (name, i, e)
            else:
                drop.add((name, i))
            continue
        last = (name, i, e)

    out: dict[str, NoteStream] = {}
    for name, stream in named_streams.items():
        kept = tuple(e for i, e in enumerate(stream.events) if (name, i) not in drop)
        out[name] = replace(stream, events=kept)
    return out


def hybrid_merge(
    mix_stream: NoteStream,
    stem_stream: NoteStream,
    *,
    onset_tolerance: float = 0.05,
) -> NoteStream:
    """Merge a full-mix decode with a stem decode: stem wins onset/pitch.

    Every stem note is kept as-is. A mix note is dropped if a stem note
    exists within ``onset_tolerance`` at the same pitch *or an octave of it*
    (mix decoders confuse octaves under masking more than a decoder hearing
    the isolated stem); otherwise it's kept as a fill-in — the full-mix model
    heard something separation attenuated out of the stem.
    """
    stem_sorted = sorted(stem_stream.events, key=lambda e: e.onset)

    def covered(mix_e: NoteEvent) -> bool:
        for s in stem_sorted:
            if s.onset - mix_e.onset > onset_tolerance:
                break
            if abs(s.onset - mix_e.onset) <= onset_tolerance and (s.pitch - mix_e.pitch) % 12 == 0:
                return True
        return False

    fills = tuple(e for e in mix_stream.events if not covered(e))
    merged = sorted((*stem_sorted, *fills), key=lambda e: (e.onset, e.pitch))
    tempo = stem_stream.tempo_bpm or mix_stream.tempo_bpm
    source = f"hybrid(stem={stem_stream.source or '?'},mix={mix_stream.source or '?'})"
    return NoteStream(tuple(merged), tempo_bpm=tempo, source=source)


def hybrid_merge_many(
    mix_stream: NoteStream,
    named_stem_streams: dict[str, NoteStream],
    *,
    onset_tolerance: float = 0.05,
) -> dict[str, NoteStream]:
    """:func:`hybrid_merge` against several instrument tracks without duplicating fills.

    Processes tracks in a stable order; once a mix note has been used as a
    fill-in for one instrument, it's removed from consideration for the rest
    — otherwise the same full-mix note would appear redundantly in every
    track that didn't already have a stem match for it.
    """
    remaining = list(mix_stream.events)
    out: dict[str, NoteStream] = {}
    for name in sorted(named_stem_streams):
        stem = named_stem_streams[name]
        partial_mix = NoteStream(
            tuple(remaining), tempo_bpm=mix_stream.tempo_bpm, source=mix_stream.source
        )
        merged = hybrid_merge(partial_mix, stem, onset_tolerance=onset_tolerance)
        out[name] = merged
        used_fills = {id(e) for e in merged.events} - {id(e) for e in stem.events}
        remaining = [e for e in remaining if id(e) not in used_fills]
    return out
