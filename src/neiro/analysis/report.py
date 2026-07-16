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


def _echo_detect(samples: np.ndarray, sample_rate: int) -> float | None:
    """Detect a discrete delay/echo via autocorrelation of the RMS envelope.

    Returns the delay in seconds, or None. Requires a fluctuating envelope —
    steady material can't carry echo evidence.
    """
    mono = samples.mean(axis=0)
    frame = max(1, sample_rate // 100)  # ~10 ms envelope resolution
    n_frames = mono.size // frame
    if n_frames < 60:
        return None
    env = np.sqrt(np.mean(mono[: n_frames * frame].reshape(n_frames, frame) ** 2, axis=1))
    env = env - env.mean()
    var = float(np.mean(env**2))
    if var < 1e-8:  # steady envelope: no evidence either way
        return None
    corr = np.correlate(env, env, mode="full")[env.size - 1 :]
    corr /= corr[0] + 1e-12
    fps = sample_rate / frame
    lo, hi = int(0.06 * fps), min(int(1.0 * fps), corr.size - 1)
    if lo >= hi:
        return None
    # Earliest strong local maximum wins: an echo's delay is shorter than the
    # phrase/beat periodicity that also shows up in envelope autocorrelation.
    for k in range(lo + 1, hi - 1):
        if corr[k] > 0.35 and corr[k] >= corr[k - 1] and corr[k] >= corr[k + 1]:
            return float(k / fps)
    return None


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


def _detect_instruments(samples: np.ndarray, sample_rate: int) -> tuple[dict[str, Any], ...]:
    """Heuristic instrument hints (roadmap §4.1 floor — no neural tagger).

    Returns ``{instrument, confidence, status}`` entries. ``status`` is
    ``asserted`` (high confidence) or ``tentative`` (possible).
    """
    sub = _band_energy(samples, sample_rate, 20, 80)
    bass = _band_energy(samples, sample_rate, 80, 250)
    low_mid = _band_energy(samples, sample_rate, 250, 800)
    mid = _band_energy(samples, sample_rate, 800, 3000)
    upper = _band_energy(samples, sample_rate, 3000, 8000)
    air = _band_energy(samples, sample_rate, 8000, 16000)
    total = sub + bass + low_mid + mid + upper + air + 1e-12
    onset = _onset_density(samples, sample_rate)

    hints: list[dict[str, Any]] = []

    def add(name: str, score: float, *, asserted_at: float = 0.55, tentative_at: float = 0.35):
        if score >= asserted_at:
            hints.append({"instrument": name, "confidence": round(score, 2), "status": "asserted"})
        elif score >= tentative_at:
            hints.append({"instrument": name, "confidence": round(score, 2), "status": "tentative"})

    drum_score = min(1.0, onset / 6.0) * (0.4 + 0.6 * (upper + mid) / total)
    add("drums", drum_score)

    bass_score = min(1.0, (sub + bass * 1.5) / total * 2.5)
    add("bass", bass_score)

    vocal_score = min(1.0, mid / total * 2.2 + low_mid / total * 0.5)
    if samples.shape[0] > 1:
        L, R = samples[0], samples[1]
        center = (L + R) * 0.5
        side = (L - R) * 0.5
        center_e = float(np.sqrt(np.mean(center**2) + 1e-12))
        side_e = float(np.sqrt(np.mean(side**2) + 1e-12))
        vocal_score *= min(1.2, 0.7 + center_e / (side_e + center_e + 1e-12))
    add("vocals", vocal_score)

    keys_score = min(1.0, (mid + upper * 0.6) / total * 1.8) * (1.0 - drum_score * 0.3)
    add("piano", keys_score * 0.85)
    add("keys", keys_score * 0.7, asserted_at=0.6)

    guitar_score = min(1.0, (mid + upper) / total * 1.6) * (1.0 - keys_score * 0.2)
    add("electric guitar", guitar_score * 0.75)

    strings_score = min(1.0, (upper + air * 0.5) / total * 2.0)
    add("strings", strings_score * 0.6, asserted_at=0.5)

    hints.sort(key=lambda h: h["confidence"], reverse=True)
    return tuple(hints[:8])


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
    echo_s = _echo_detect(samples, sr)
    if echo_s is not None:
        notes.append(f"discrete echo/delay around {echo_s * 1000:.0f} ms")

    conditions = {"stereo_correlation": round(corr, 4)}
    if hum_hz is not None:
        conditions["hum_hz"] = hum_hz
        conditions["hum_prominence_db"] = round(hum_db, 1)
    if echo_s is not None:
        conditions["echo_delay_s"] = round(echo_s, 3)

    instruments = _detect_instruments(samples, sr)
    tagger_capability = "dsp-instrument-hints"
    neural_tags = _neural_instrument_tags(audio, registry)
    if neural_tags is not None:
        instruments = neural_tags
        tagger_capability = "neural-instrument-tagger"
        notes.append("instrument tagging: neural tagger via registry 'analyze' task")
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
