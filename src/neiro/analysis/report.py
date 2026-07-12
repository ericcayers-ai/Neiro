"""Lightweight, dependency-free analysis pass.

Produces an :class:`AnalysisReport` with the musical priors the planner and UI
rely on. Everything here is real signal processing (no neural nets): loudness,
clipping, bandwidth, a stereo-width / mono check, an onset-autocorrelation tempo
estimate, and a Krumhansl-Schmuckler key estimate. The neural taggers of roadmap
§4.1–4.2 (instrument detection, vocal-condition detection) attach here later as
registry ``analyze``-task models; this is the always-available floor.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp import stft
from neiro.engine.artifacts import AnalysisReport, AudioTensor

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _integrated_lufs(samples: np.ndarray, sample_rate: int) -> float:
    """Approximate EBU R128 integrated loudness (K-weighting omitted for speed)."""
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


def analyze(audio: AudioTensor) -> AnalysisReport:
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

    return AnalysisReport(
        duration_seconds=audio.duration_seconds,
        sample_rate=sr,
        channels=audio.channels,
        is_effectively_mono=is_mono,
        integrated_lufs=_integrated_lufs(samples, sr),
        peak_dbfs=float(20 * np.log10(audio.peak() + 1e-12)),
        estimated_bpm=_tempo(samples, sr),
        estimated_key=_estimate_key(chroma),
        bandwidth_hz=bandwidth,
        clipping_ratio=clip,
        noise_floor_dbfs=_noise_floor_dbfs(samples),
        vocal_conditions=conditions,
        notes=tuple(notes),
    )
