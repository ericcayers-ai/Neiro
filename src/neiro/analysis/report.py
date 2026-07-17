"""Lightweight, dependency-free analysis pass.

Produces an :class:`AnalysisReport` with the musical priors the planner and UI
rely on. Everything here is real signal processing (no neural nets): loudness,
clipping, bandwidth, a stereo-width / mono check, an onset-autocorrelation tempo
estimate, and a Krumhansl-Schmuckler key estimate. The neural taggers of roadmap
§4.1–4.2 (instrument detection, vocal-condition detection) attach here later as
registry ``analyze``-task models; this is the always-available floor.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from neiro.dsp import stft
from neiro.engine.artifacts import AnalysisReport, AudioTensor

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _integrated_lufs(samples: np.ndarray, sample_rate: int) -> float:
    """Integrated loudness (LUFS).

    Uses ``pyloudnorm``'s ITU-R BS.1770-4 meter (K-weighting + gating) when the
    optional dependency is installed — the broadcast-standard measurement. Falls
    back to a fast unweighted approximation otherwise, so the analysis pass never
    hard-depends on it. Very short signals below the 0.4 s block size use the
    approximation regardless (BS.1770 gating is undefined there).
    """
    block = int(0.4 * sample_rate)
    if samples.shape[1] >= block:
        try:
            import pyloudnorm as pyln

            meter = pyln.Meter(sample_rate)
            # pyloudnorm expects (samples, channels).
            loudness = meter.integrated_loudness(samples.T.astype(np.float64))
            if np.isfinite(loudness):
                return float(loudness)
        except Exception:
            pass  # fall through to the approximation
    return _integrated_lufs_approx(samples, sample_rate)


def _integrated_lufs_approx(samples: np.ndarray, sample_rate: int) -> float:
    """Fast unweighted gated-loudness approximation (fallback for _integrated_lufs)."""
    mono = samples.mean(axis=0)
    block = int(0.4 * sample_rate)
    if block <= 0 or mono.size < block:
        rms = np.sqrt(np.mean(mono**2) + 1e-12)
        return float(-0.691 + 20 * np.log10(rms + 1e-12))
    hop = block // 4
    powers = []
    for start in range(0, mono.size - block + 1, hop):
        seg = mono[start : start + block]
        powers.append(np.mean(seg**2))
    powers = np.array(powers)
    gate = powers > (np.mean(powers) * 0.1)
    used = powers[gate] if gate.any() else powers
    mean_power = np.mean(used) + 1e-12
    return float(-0.691 + 10 * np.log10(mean_power))


def _bandwidth(samples: np.ndarray, sample_rate: int) -> float:
    mono = samples.mean(axis=0)
    S = np.abs(stft(mono, n_fft=4096, hop=2048))
    spectrum = S.mean(axis=1)
    total = spectrum.sum() + 1e-12
    cumulative = np.cumsum(spectrum) / total
    idx = int(np.searchsorted(cumulative, 0.995))
    freqs = np.fft.rfftfreq(4096, 1 / sample_rate)
    idx = min(idx, len(freqs) - 1)
    return float(freqs[idx])


def _tempo(samples: np.ndarray, sample_rate: int) -> float | None:
    mono = samples.mean(axis=0)
    n_fft, hop = 2048, 512
    S = np.abs(stft(mono, n_fft=n_fft, hop=hop))
    # Spectral flux onset envelope.
    flux = np.maximum(0.0, np.diff(S, axis=1)).sum(axis=0)
    if flux.size < 8:
        return None
    flux = flux - flux.mean()
    corr = np.correlate(flux, flux, mode="full")[flux.size - 1 :]
    fps = sample_rate / hop
    min_lag = int(fps * 60 / 200)  # 200 BPM
    max_lag = int(fps * 60 / 40)  # 40 BPM
    if max_lag >= corr.size:
        max_lag = corr.size - 1
    if min_lag >= max_lag:
        return None
    lag = min_lag + int(np.argmax(corr[min_lag:max_lag]))
    if lag <= 0:
        return None
    return float(60.0 * fps / lag)


def _chroma(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    mono = samples.mean(axis=0)
    n_fft, hop = 4096, 2048
    S = np.abs(stft(mono, n_fft=n_fft, hop=hop))
    freqs = np.fft.rfftfreq(n_fft, 1 / sample_rate)
    chroma = np.zeros(12)
    for b, f in enumerate(freqs):
        if f < 27.5 or f > 5000:
            continue
        midi = 69 + 12 * np.log2(f / 440.0)
        pc = int(round(midi)) % 12
        chroma[pc] += S[b].sum()
    if chroma.sum() > 0:
        chroma /= chroma.sum()
    return chroma


def _estimate_key(chroma: np.ndarray) -> str | None:
    if chroma.sum() == 0:
        return None
    best_score = -np.inf
    best = None
    for tonic in range(12):
        maj = np.corrcoef(chroma, np.roll(_MAJOR, tonic))[0, 1]
        minr = np.corrcoef(chroma, np.roll(_MINOR, tonic))[0, 1]
        if maj > best_score:
            best_score, best = maj, f"{_NOTE_NAMES[tonic]} major"
        if minr > best_score:
            best_score, best = minr, f"{_NOTE_NAMES[tonic]} minor"
    return best


def _mono_check(samples: np.ndarray) -> tuple[bool, float]:
    if samples.shape[0] == 1:
        return True, 1.0
    L, R = samples[0], samples[1]
    denom = (np.linalg.norm(L) * np.linalg.norm(R)) + 1e-12
    corr = float(np.dot(L, R) / denom)
    return corr > 0.999, corr


def _clipping_ratio(samples: np.ndarray) -> float:
    at_ceiling = np.abs(samples) >= 0.999
    return float(at_ceiling.mean())


def _hum_detect(samples: np.ndarray, sample_rate: int) -> tuple[float | None, float]:
    """Detect mains hum. Returns (fundamental Hz or None, prominence dB).

    Compares narrowband energy at 50/60 Hz (and their 2nd/3rd harmonics) against
    the median of the surrounding spectrum.
    """
    mono = samples.mean(axis=0)
    n = min(mono.size, sample_rate * 20)  # up to 20 s is plenty
    spec = np.abs(np.fft.rfft(mono[:n]))
    freqs = np.fft.rfftfreq(n, 1 / sample_rate)

    def band_energy(f: float, half_width: float) -> float:
        m = (freqs >= f - half_width) & (freqs <= f + half_width)
        return float(spec[m].max()) if m.any() else 0.0

    best: tuple[float | None, float] = (None, 0.0)
    for fundamental in (50.0, 60.0):
        peak = 0.0
        for k in (1, 2, 3):
            peak = max(peak, band_energy(fundamental * k, 1.5))
        # Local reference: median magnitude in 20–300 Hz excluding the hum bins.
        ref_mask = (freqs >= 20) & (freqs <= 300)
        for k in (1, 2, 3):
            ref_mask &= ~((freqs >= fundamental * k - 3) & (freqs <= fundamental * k + 3))
        ref = float(np.median(spec[ref_mask])) if ref_mask.any() else 1e-12
        prominence_db = 20 * np.log10((peak + 1e-12) / (ref + 1e-12))
        if prominence_db > best[1]:
            best = (fundamental, prominence_db)
    if best[1] >= 30.0:
        return best
    return None, best[1]


def _echo_candidates(
    samples: np.ndarray, sample_rate: int, *, min_peak: float = 0.35
) -> list[tuple[float, float]]:
    """List discrete delay/echo peaks via envelope autocorrelation.

    Searches ``60–1000 ms``. Returns ``[(delay_seconds, confidence), ...]``
    sorted by confidence descending. Requires a fluctuating envelope.
    """
    mono = samples.mean(axis=0)
    frame = max(1, sample_rate // 100)  # ~10 ms envelope resolution
    n_frames = mono.size // frame
    if n_frames < 60:
        return []
    env = np.sqrt(np.mean(mono[: n_frames * frame].reshape(n_frames, frame) ** 2, axis=1))
    env = env - env.mean()
    var = float(np.mean(env**2))
    if var < 1e-8:  # steady envelope: no evidence either way
        return []
    corr = np.correlate(env, env, mode="full")[env.size - 1 :]
    corr /= corr[0] + 1e-12
    fps = sample_rate / frame
    lo, hi = int(0.06 * fps), min(int(1.0 * fps), corr.size - 1)
    if lo >= hi:
        return []
    peaks: list[tuple[float, float]] = []
    for k in range(lo + 1, hi - 1):
        peak = float(corr[k])
        if peak > min_peak and corr[k] >= corr[k - 1] and corr[k] >= corr[k + 1]:
            # Skip near-duplicates of a stronger neighbour (±30 ms).
            delay_s = float(k / fps)
            if any(abs(delay_s - d) < 0.03 for d, _ in peaks):
                continue
            peaks.append((delay_s, float(min(1.0, peak))))
    peaks.sort(key=lambda p: p[1], reverse=True)
    return peaks[:6]


def _echo_detect(samples: np.ndarray, sample_rate: int) -> tuple[float, float] | None:
    """Best discrete delay/echo via autocorrelation of the RMS envelope.

    Returns ``(delay_seconds, confidence)`` or None. Prefer the earliest strong
    peak among high-confidence candidates (echo delay is shorter than phrase/
    beat periodicity that also appears in envelope autocorrelation).
    """
    candidates = _echo_candidates(samples, sample_rate)
    if not candidates:
        return None
    # Prefer earliest among peaks within 85% of the strongest confidence.
    top_conf = candidates[0][1]
    strong = [c for c in candidates if c[1] >= top_conf * 0.85]
    strong.sort(key=lambda c: c[0])
    return strong[0]


def _draft_preview_stems(samples: np.ndarray, sample_rate: int) -> dict[str, np.ndarray] | None:
    """DSP-fast vocals/drums proxies for stem-conditioned condition detection.

    Uses centre-extract (vocals) and HPSS percussive (drums). Returns None when
    the clip is too short for a meaningful preview split.
    """
    if samples.shape[1] < sample_rate:  # need ≥1 s
        return None
    try:
        from neiro.dsp.separation import center_extract, harmonic_percussive
    except Exception:
        return None
    try:
        vocals, _ = center_extract(samples, sample_rate)
        _, drums = harmonic_percussive(samples, sample_rate)
    except Exception:
        return None
    return {"vocals": vocals, "drums": drums}


def _stem_echo_conditions(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """Run echo/delay detection on the mix and optional draft vocal/drum stems.

    Prefers stem-conditioned delays when the preview split succeeds. Always
    includes mix-level detection as a fallback. Surfaces multi-peak candidates
    in ms for the Analysis UI.
    """
    out: dict[str, Any] = {}
    mix_cands = _echo_candidates(samples, sample_rate)
    if mix_cands:
        delay_s, conf = mix_cands[0]
        # Prefer earliest among near-top peaks (same rule as `_echo_detect`).
        top = mix_cands[0][1]
        strong = sorted([c for c in mix_cands if c[1] >= top * 0.85], key=lambda c: c[0])
        delay_s, conf = strong[0]
        out["echo_delay_s"] = round(delay_s, 3)
        out["echo_confidence"] = round(conf, 3)
        out["echo_source"] = "mix"
        out["echo_candidates_ms"] = [
            {"ms": int(round(d * 1000)), "confidence": round(c, 3)} for d, c in mix_cands
        ]

    stems = _draft_preview_stems(samples, sample_rate)
    if stems is None:
        return out

    stem_echo: dict[str, Any] = {}
    best_stem: tuple[str, float, float] | None = None  # name, delay, conf
    merged_cands: list[tuple[float, float]] = list(mix_cands)
    for name, stem in stems.items():
        cands = _echo_candidates(stem, sample_rate)
        if not cands:
            continue
        top = cands[0][1]
        strong = sorted([c for c in cands if c[1] >= top * 0.85], key=lambda c: c[0])
        delay_s, conf = strong[0]
        stem_echo[name] = {
            "delay_s": round(delay_s, 3),
            "confidence": round(conf, 3),
            "candidates_ms": [
                {"ms": int(round(d * 1000)), "confidence": round(c, 3)} for d, c in cands
            ],
        }
        merged_cands.extend(cands)
        if best_stem is None or conf > best_stem[2]:
            best_stem = (name, delay_s, conf)

    if not stem_echo:
        return out

    out["stem_echo"] = stem_echo
    out["echo_based_on_preview_split"] = True
    # Prefer the strongest stem-conditioned peak over the mix measurement.
    if best_stem is not None:
        name, delay_s, conf = best_stem
        out["echo_delay_s"] = round(delay_s, 3)
        out["echo_confidence"] = round(conf, 3)
        out["echo_source"] = f"preview_split_{name}"
    # Deduplicate merged candidates (±30 ms) keeping highest confidence.
    if merged_cands:
        merged_cands.sort(key=lambda c: c[1], reverse=True)
        uniq: list[tuple[float, float]] = []
        for d, c in merged_cands:
            if any(abs(d - ud) < 0.03 for ud, _ in uniq):
                continue
            uniq.append((d, c))
        out["echo_candidates_ms"] = [
            {"ms": int(round(d * 1000)), "confidence": round(c, 3)} for d, c in uniq[:8]
        ]
    return out


def _band_energy(samples: np.ndarray, sample_rate: int, lo: float, hi: float) -> float:
    """Mean magnitude in a frequency band (mono)."""
    mono = samples.mean(axis=0)
    n = min(mono.size, sample_rate * 30)
    spec = np.abs(np.fft.rfft(mono[:n]))
    freqs = np.fft.rfftfreq(n, 1 / sample_rate)
    mask = (freqs >= lo) & (freqs < hi)
    if not mask.any():
        return 0.0
    return float(spec[mask].mean())


def _onset_density(samples: np.ndarray, sample_rate: int) -> float:
    """Onsets per second from spectral-flux peaks (proxy for drum activity)."""
    mono = samples.mean(axis=0)
    n_fft, hop = 2048, 512
    if mono.size < n_fft * 4:
        return 0.0
    S = np.abs(stft(mono, n_fft=n_fft, hop=hop))
    flux = np.maximum(0.0, np.diff(S, axis=1)).sum(axis=0)
    if flux.size < 8:
        return 0.0
    thr = flux.mean() + flux.std()
    onsets = int((flux > thr).sum())
    seconds = mono.size / sample_rate
    return onsets / max(seconds, 0.1)


def _canonical_instrument(name: str) -> str:
    """Collapse near-synonyms for voting (display name kept from strongest vote)."""
    n = name.strip().lower()
    aliases = {
        "electric guitar": "guitar",
        "acoustic guitar": "guitar",
        "guitar": "guitar",
        "piano": "piano",
        "keys": "keys",
        "keyboard": "keys",
        "synthesizer": "synth",
        "synth": "synth",
        "drums": "drums",
        "percussion": "drums",
        "bass": "bass",
        "vocals": "vocals",
        "choir": "vocals",
        "spoken voice": "vocals",
        "strings": "strings",
        "orchestra": "strings",
        "brass": "brass",
        "woodwinds": "woodwinds",
    }
    return aliases.get(n, n)


def _detect_instruments(samples: np.ndarray, sample_rate: int) -> tuple[dict[str, Any], ...]:
    """Heuristic instrument hints (roadmap §4.1 floor — no neural tagger).

    Returns ``{instrument, confidence, status}`` entries. ``status`` is
    ``asserted`` (high confidence) or ``tentative`` (possible).

    Bass is gated on *relative* low-band dominance so broadband mixes no longer
    falsely assert bass from kick/sub energy alone.
    """
    sub = _band_energy(samples, sample_rate, 20, 80)
    bass = _band_energy(samples, sample_rate, 80, 250)
    low_mid = _band_energy(samples, sample_rate, 250, 800)
    mid = _band_energy(samples, sample_rate, 800, 3000)
    upper = _band_energy(samples, sample_rate, 3000, 8000)
    air = _band_energy(samples, sample_rate, 8000, 16000)
    total = sub + bass + low_mid + mid + upper + air + 1e-12
    sub_f, bass_f = sub / total, bass / total
    low_mid_f, mid_f = low_mid / total, mid / total
    upper_f, air_f = upper / total, air / total
    low_f = sub_f + bass_f
    onset = _onset_density(samples, sample_rate)

    hints: list[dict[str, Any]] = []

    def add(
        name: str,
        score: float,
        *,
        asserted_at: float = 0.55,
        tentative_at: float = 0.35,
        source: str = "dsp",
    ):
        score = float(np.clip(score, 0.0, 1.0))
        if score >= asserted_at:
            hints.append(
                {
                    "instrument": name,
                    "confidence": round(score, 2),
                    "status": "asserted",
                    "source": source,
                }
            )
        elif score >= tentative_at:
            hints.append(
                {
                    "instrument": name,
                    "confidence": round(score, 2),
                    "status": "tentative",
                    "source": source,
                }
            )

    # Drums: onset density + mid/high energy (cymbals/snare), not just bass thump.
    drum_score = min(1.0, onset / 4.5) * (0.35 + 0.65 * (upper_f + mid_f))
    if onset >= 3.0:
        drum_score = min(1.0, drum_score * 1.15)
    add("drums", drum_score)

    # Bass: require low-band share AND dominance vs mid — old formula asserted
    # bass on nearly every mix because (sub+bass)/total * 2.5 easily cleared 0.55.
    bass_score = 0.0
    if low_f > 0.18 and low_f > (low_mid_f + mid_f) * 0.45:
        bass_score = min(1.0, (low_f - 0.12) * 2.8)
        if drum_score > 0.55:
            bass_score *= 0.5  # kick bleed looks like bass
        if mid_f > 0.28:
            bass_score *= 0.75
    add("bass", bass_score, asserted_at=0.58, tentative_at=0.4)

    # Vocals: mid-band presence + centre image (when stereo).
    vocal_score = min(1.0, mid_f * 2.8 + low_mid_f * 0.7 + air_f * 0.4)
    if samples.shape[0] > 1:
        L, R = samples[0], samples[1]
        center = (L + R) * 0.5
        side = (L - R) * 0.5
        center_e = float(np.sqrt(np.mean(center**2) + 1e-12))
        side_e = float(np.sqrt(np.mean(side**2) + 1e-12))
        vocal_score *= min(1.25, 0.65 + center_e / (side_e + center_e + 1e-12))
    if onset > 5.0 and drum_score > 0.6:
        vocal_score *= 0.85  # dense percussion can inflate mid energy
    add("vocals", vocal_score)

    # Keys / piano: sustained harmonic mid+upper, lower onset than drums.
    keys_score = min(1.0, (mid_f + upper_f * 0.75) * 1.9) * (1.0 - drum_score * 0.35)
    if onset < 3.5:
        keys_score = min(1.0, keys_score * 1.2)
    add("piano", keys_score * 0.95, asserted_at=0.52)
    add("keys", keys_score * 0.8, asserted_at=0.58, tentative_at=0.38)

    # Guitar: mid+upper with some attack; damp when keys dominate.
    guitar_score = min(1.0, (mid_f + upper_f) * 1.7) * (0.65 + 0.35 * min(1.0, onset / 3.0))
    guitar_score *= 1.0 - keys_score * 0.25
    add("electric guitar", guitar_score * 0.85, asserted_at=0.55, tentative_at=0.36)

    strings_score = min(1.0, (upper_f + air_f * 0.6) * 2.1) * (1.0 - drum_score * 0.2)
    add("strings", strings_score * 0.65, asserted_at=0.52, tentative_at=0.36)

    hints.sort(key=lambda h: h["confidence"], reverse=True)
    return tuple(hints[:8])


def _vote_instrument_tags(
    dsp: tuple[dict[str, Any], ...],
    neural: tuple[dict[str, Any], ...],
    *,
    neural_weight: float = 0.55,
) -> tuple[dict[str, Any], ...]:
    """Merge DSP heuristics with neural (CLAP) tags into a single ranked list."""
    dsp_w = 1.0 - neural_weight
    buckets: dict[str, dict[str, Any]] = {}

    def ingest(tags: tuple[dict[str, Any], ...], weight: float, source: str) -> None:
        for tag in tags:
            name = str(tag.get("instrument") or "").strip()
            if not name:
                continue
            key = _canonical_instrument(name)
            conf = float(tag.get("confidence") or 0.0) * weight
            slot = buckets.get(key)
            if slot is None:
                buckets[key] = {
                    "instrument": name,
                    "confidence": conf,
                    "sources": {source},
                    "display_conf": conf,
                }
            else:
                slot["confidence"] += conf
                slot["sources"].add(source)
                # Prefer the higher-confidence display name.
                if conf > slot["display_conf"]:
                    slot["instrument"] = name
                    slot["display_conf"] = conf

    ingest(dsp, dsp_w, "dsp")
    ingest(neural, neural_weight, "neural")

    out: list[dict[str, Any]] = []
    for slot in buckets.values():
        score = float(np.clip(slot["confidence"], 0.0, 1.0))
        sources = slot["sources"]
        if "dsp" in sources and "neural" in sources:
            source = "vote"
            # Agreement boost
            score = float(np.clip(score * 1.08, 0.0, 1.0))
        elif "neural" in sources:
            source = "neural"
        else:
            source = "dsp"
        if score >= 0.52:
            status = "asserted"
        elif score >= 0.32:
            status = "tentative"
        else:
            continue
        out.append(
            {
                "instrument": slot["instrument"],
                "confidence": round(score, 2),
                "status": status,
                "source": source,
            }
        )
    out.sort(key=lambda h: h["confidence"], reverse=True)
    return tuple(out[:8])


def _neural_instrument_tags(
    audio: AudioTensor, registry: Any | None
) -> tuple[dict[str, Any], ...] | None:
    """Optional neural instrument tagger hook (roadmap §4.1 tagger ensemble).

    If ``registry`` has a usable model registered for the ``analyze`` task,
    it is expected to expose ``instantiate().tag(audio) -> Iterable[dict]``
    yielding the same ``{instrument, confidence, status}`` hint shape as the
    DSP heuristic below, so callers never need to branch on which backend
    produced the tags. Any failure (missing model, adapter error, …) degrades
    silently to the DSP floor.
    """
    if registry is None:
        return None
    best_for = getattr(registry, "best_for", None)
    if not callable(best_for):
        return None
    try:
        entry = best_for("analyze", "standard")
    except Exception:
        return None
    if entry is None:
        return None
    available = getattr(entry, "available", None)
    if callable(available) and not available():
        return None
    try:
        adapter = entry.instantiate()
        tagger = getattr(adapter, "tag", None) or getattr(adapter, "analyze", None)
        if tagger is None:
            return None
        tags = tuple(tagger(audio))
        return tags or None
    except Exception:
        return None


def _noise_floor_dbfs(samples: np.ndarray) -> float:
    mono = samples.mean(axis=0)
    frame = 2048
    if mono.size < frame:
        rms = np.sqrt(np.mean(mono**2) + 1e-12)
        return float(20 * np.log10(rms + 1e-12))
    hop = frame
    rms_vals = []
    for start in range(0, mono.size - frame + 1, hop):
        seg = mono[start : start + frame]
        rms_vals.append(np.sqrt(np.mean(seg**2) + 1e-12))
    rms_vals = np.array(rms_vals)
    floor = np.percentile(rms_vals, 10)
    return float(20 * np.log10(floor + 1e-12))


_CHORD_TEMPLATES = {
    "C": np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=np.float64),
    "Am": np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=np.float64),
    "F": np.array([1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], dtype=np.float64),
    "G": np.array([0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1], dtype=np.float64),
    "Dm": np.array([0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0], dtype=np.float64),
    "Em": np.array([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1], dtype=np.float64),
}


def _estimate_chords(
    chroma: np.ndarray, bpm: float | None, duration: float
) -> tuple[dict[str, Any], ...]:
    """Sparse chord lattice from global chroma vs. major/minor templates."""
    if chroma is None or chroma.size != 12 or duration <= 0:
        return ()
    c = chroma / (chroma.sum() + 1e-12)
    scores = []
    for name, tmpl in _CHORD_TEMPLATES.items():
        t = tmpl / (tmpl.sum() + 1e-12)
        scores.append((name, float(np.dot(c, t))))
    scores.sort(key=lambda x: x[1], reverse=True)
    top = scores[0]
    # One global chord label with start/end for the whole clip (lattice can refine later)
    return (
        {
            "chord": top[0],
            "confidence": round(top[1], 3),
            "start": 0.0,
            "end": round(duration, 3),
        },
    )


def _estimate_sections(
    samples: np.ndarray, sample_rate: int, bpm: float | None, duration: float
) -> tuple[dict[str, Any], ...]:
    """Heuristic intro/verse/chorus segmentation by energy curve breaks."""
    if duration < 8:
        return ({"label": "full", "start": 0.0, "end": round(duration, 3)},)
    mono = samples.mean(axis=0)
    n_blocks = max(4, int(duration / 4))
    block = max(1, mono.size // n_blocks)
    energies = []
    for i in range(n_blocks):
        seg = mono[i * block : (i + 1) * block]
        energies.append(float(np.sqrt(np.mean(seg**2) + 1e-12)))
    energies = np.array(energies)
    med = float(np.median(energies))
    labels = []
    for i, e in enumerate(energies):
        start = i * (duration / n_blocks)
        end = (i + 1) * (duration / n_blocks)
        if i == 0 and e < med * 0.85:
            label = "intro"
        elif e >= med * 1.15:
            label = "chorus"
        else:
            label = "verse"
        if labels and labels[-1]["label"] == label:
            labels[-1]["end"] = round(end, 3)
        else:
            labels.append({"label": label, "start": round(start, 3), "end": round(end, 3)})
    return tuple(labels)


def _estimate_downbeats(bpm: float | None, duration: float) -> tuple[float, ...]:
    if not bpm or bpm <= 0 or duration <= 0:
        return ()
    beat = 60.0 / bpm
    bar = beat * 4
    times = []
    t = 0.0
    while t < duration:
        times.append(round(t, 4))
        t += bar
    return tuple(times[:512])


def _estimate_rt60(samples: np.ndarray, sample_rate: int) -> float | None:
    """Very rough late-decay estimate for vocal-dominant bands (heuristic)."""
    mono = samples.mean(axis=0)
    if mono.size < sample_rate:
        return None
    # Use last 25% energy envelope slope
    tail = mono[int(mono.size * 0.75) :]
    frame = max(256, sample_rate // 50)
    envs = []
    for i in range(0, tail.size - frame, frame):
        envs.append(float(np.sqrt(np.mean(tail[i : i + frame] ** 2) + 1e-12)))
    if len(envs) < 4:
        return None
    envs = np.array(envs)
    db = 20 * np.log10(envs + 1e-12)
    # Fit simple slope
    x = np.arange(len(db))
    slope = float(np.polyfit(x, db, 1)[0])
    if slope >= -0.05:
        return 0.2
    # Convert dB/frame to time for -60 dB
    seconds_per_frame = frame / sample_rate
    rt60 = abs(60.0 / (slope / seconds_per_frame))
    return float(np.clip(rt60, 0.15, 4.0))


def analyze(audio: AudioTensor, *, registry: Any | None = None) -> AnalysisReport:
    """Run the analysis pass.

    ``registry`` is optional: when given, an ``analyze``-task model (see
    :func:`_neural_instrument_tags`) is tried first for instrument tagging,
    falling back to the DSP heuristic on any failure or absence — the same
    "neural preferred, DSP floor always available" contract the separation
    and transcription planners use.
    """
    samples = audio.samples
    sr = audio.sample_rate
    is_mono, corr = _mono_check(samples)
    chroma = _chroma(samples, sr)
    notes: list[str] = []

    clip = _clipping_ratio(samples)
    if clip > 0.001:
        notes.append(f"clipping detected ({clip * 100:.2f}% of samples at ceiling)")
    bandwidth = _bandwidth(samples, sr)
    if bandwidth < 16000 and sr >= 44100:
        notes.append(
            f"bandwidth limited to ~{bandwidth / 1000:.1f} kHz — likely lossy source; "
            "restoration may improve separation"
        )
    if is_mono and samples.shape[0] > 1:
        notes.append("stereo file is effectively mono (L/R correlation > 0.999)")

    hum_hz, hum_db = _hum_detect(samples, sr)
    if hum_hz is not None:
        notes.append(f"mains hum at {hum_hz:.0f} Hz ({hum_db:.0f} dB above local floor)")

    echo_conditions = _stem_echo_conditions(samples, sr)
    echo_s = echo_conditions.get("echo_delay_s")
    if echo_s is not None:
        conf = echo_conditions.get("echo_confidence")
        conf_txt = f", confidence {conf:.0%}" if isinstance(conf, (int, float)) else ""
        source = echo_conditions.get("echo_source", "mix")
        if echo_conditions.get("echo_based_on_preview_split"):
            notes.append(
                f"discrete echo/delay around {float(echo_s) * 1000:.0f} ms"
                f"{conf_txt} (based on preview split · {source})"
            )
        else:
            notes.append(f"discrete echo/delay around {float(echo_s) * 1000:.0f} ms{conf_txt}")

    conditions: dict[str, Any] = {"stereo_correlation": round(corr, 4)}
    if hum_hz is not None:
        conditions["hum_hz"] = hum_hz
        conditions["hum_prominence_db"] = round(hum_db, 1)
    conditions.update(echo_conditions)

    instruments = _detect_instruments(samples, sr)
    tagger_capability = "dsp-instrument-hints"
    neural_tags = _neural_instrument_tags(audio, registry)
    if neural_tags is not None:
        instruments = _vote_instrument_tags(instruments, neural_tags)
        tagger_capability = "dsp+neural-instrument-vote"
        notes.append("instrument tagging: DSP + neural (an-clap) vote")
    if instruments:
        asserted = [h["instrument"] for h in instruments if h["status"] == "asserted"]
        if asserted:
            notes.append("detected: " + ", ".join(asserted[:6]))

    bpm = _tempo(samples, sr)
    key = _estimate_key(chroma)
    chords = _estimate_chords(chroma, bpm, audio.duration_seconds)
    sections = _estimate_sections(samples, sr, bpm, audio.duration_seconds)
    downbeats = _estimate_downbeats(bpm, audio.duration_seconds)
    capabilities = (
        "dsp-loudness",
        "dsp-tempo-key",
        tagger_capability,
        "dsp-chord-lattice",
        "dsp-structure",
        "dsp-hum-echo",
    )
    if tagger_capability == "dsp-instrument-hints":
        notes.append("analysis capabilities: DSP floor (neural taggers attach when installed)")

    # RT60-style reverb estimate from decay of late energy after onsets (heuristic)
    rt60 = _estimate_rt60(samples, sr)
    if rt60 is not None:
        conditions["rt60_s"] = round(rt60, 2)
        if rt60 > 0.6:
            notes.append(f"estimated RT60 ~{rt60:.1f} s — consider dereverb before transcription")

    return AnalysisReport(
        duration_seconds=audio.duration_seconds,
        sample_rate=sr,
        channels=audio.channels,
        is_effectively_mono=is_mono,
        integrated_lufs=_integrated_lufs(samples, sr),
        peak_dbfs=float(20 * np.log10(audio.peak() + 1e-12)),
        estimated_bpm=bpm,
        estimated_key=key,
        bandwidth_hz=bandwidth,
        clipping_ratio=clip,
        noise_floor_dbfs=_noise_floor_dbfs(samples),
        instruments=instruments,
        vocal_conditions=conditions,
        notes=tuple(notes),
        schema_version=2,
        chords=chords,
        sections=sections,
        downbeats=downbeats,
        capabilities=capabilities,
    )
