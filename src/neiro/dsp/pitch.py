"""Pitch tracking and note segmentation (roadmap §7 — the always-available floor).

Implements YIN (de Cheveigné & Kawahara, 2002) fundamental-frequency estimation
with the cumulative-mean-normalised difference function and parabolic
interpolation, plus onset detection and a note segmenter that turns an f0 track
into discrete :class:`NoteEvent` intervals with velocities from frame energy.

This is the model-free transcription lane: monophonic, honest about it, and
labeled draft quality. Neural decoders (Basic Pitch, Transkun, …) plug in through
the registry and supersede it for polyphonic material.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.separation import stft
from neiro.engine.artifacts import NoteEvent, NoteStream

__all__ = ["yin_track", "spectral_flux_onsets", "segment_notes", "transcribe_mono"]


def yin_track(
    x: np.ndarray,
    sr: int,
    frame: int = 1024,
    hop: int = 256,
    fmin: float = 60.0,
    fmax: float = 1200.0,
    threshold: float = 0.15,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """YIN f0 tracking on a mono signal.

    Returns ``(times, f0, voiced)`` — f0 is 0 where unvoiced.
    """
    x = np.asarray(x, dtype=np.float64)
    tau_min = max(2, int(sr / fmax))
    tau_max = min(frame - 2, int(sr / fmin))
    if tau_max <= tau_min:
        raise ValueError("fmin/fmax incompatible with frame size")

    n_frames = max(0, 1 + (len(x) - 2 * frame) // hop)
    times = np.zeros(n_frames)
    f0 = np.zeros(n_frames)
    voiced = np.zeros(n_frames, dtype=bool)

    taus = np.arange(tau_min, tau_max + 1)
    for i in range(n_frames):
        start = i * hop
        seg = x[start : start + 2 * frame]
        w = seg[:frame]
        times[i] = (start + frame / 2) / sr
        # Silence guard: a zero difference function is not periodicity.
        if np.sum(w**2) < 1e-10:
            continue
        # Difference function d(tau) over the candidate lags, vectorised.
        shifted = np.lib.stride_tricks.sliding_window_view(seg, frame)[taus]
        d = np.sum((w[np.newaxis, :] - shifted) ** 2, axis=1)
        # Cumulative mean normalised difference.
        cumsum = np.cumsum(d)
        cmndf = d * taus / np.maximum(cumsum, 1e-12)

        below = np.where(cmndf < threshold)[0]
        if below.size == 0:
            continue
        # First dip below threshold, refined to the local minimum.
        k = below[0]
        while k + 1 < len(cmndf) and cmndf[k + 1] < cmndf[k]:
            k += 1
        # Parabolic interpolation around the minimum.
        tau = float(taus[k])
        if 0 < k < len(cmndf) - 1:
            a, b, c = cmndf[k - 1], cmndf[k], cmndf[k + 1]
            denom = a - 2 * b + c
            if abs(denom) > 1e-12:
                tau += 0.5 * (a - c) / denom
        f0[i] = sr / tau
        voiced[i] = True

    return times, f0, voiced


def spectral_flux_onsets(
    x: np.ndarray,
    sr: int,
    n_fft: int = 1024,
    hop: int = 256,
    delta: float = 1.5,
) -> np.ndarray:
    """Onset times via positive spectral flux with an adaptive median threshold."""
    S = np.abs(stft(np.asarray(x, dtype=np.float32), n_fft, hop))
    flux = np.maximum(0.0, np.diff(S, axis=1)).sum(axis=0)
    if flux.size < 3:
        return np.array([])
    # Adaptive threshold: local median over ~0.4 s plus a floor.
    win = max(3, int(0.4 * sr / hop) | 1)
    pad = win // 2
    padded = np.pad(flux, pad, mode="edge")
    med = np.array([np.median(padded[i : i + win]) for i in range(flux.size)])
    thresh = delta * med + 0.01 * flux.max()
    peaks = []
    for i in range(1, flux.size - 1):
        if flux[i] > thresh[i] and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]:
            peaks.append((i + 1) * hop / sr)  # +1: diff shifts by one frame
    # Merge onsets closer than 50 ms.
    merged: list[float] = []
    for t in peaks:
        if not merged or t - merged[-1] > 0.05:
            merged.append(t)
    return np.array(merged)


def _frame_rms(x: np.ndarray, times: np.ndarray, sr: int, frame: int) -> np.ndarray:
    out = np.zeros(len(times))
    for i, t in enumerate(times):
        c = int(t * sr)
        seg = x[max(0, c - frame // 2) : c + frame // 2]
        out[i] = np.sqrt(np.mean(seg**2)) if seg.size else 0.0
    return out


def segment_notes(
    times: np.ndarray,
    f0: np.ndarray,
    voiced: np.ndarray,
    energies: np.ndarray,
    *,
    min_duration: float = 0.06,
    max_gap_frames: int = 2,
    track: str = "melody",
) -> list[NoteEvent]:
    """Group voiced frames into notes; split on pitch change or voicing gaps."""
    events: list[NoteEvent] = []
    midi = np.where(f0 > 0, 69.0 + 12.0 * np.log2(np.maximum(f0, 1e-6) / 440.0), -1.0)

    i, n = 0, len(times)
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        # Start a note at frame i.
        pitch_ref = midi[i]
        j = i
        gap = 0
        members = [i]
        while j + 1 < n:
            j += 1
            if not voiced[j]:
                gap += 1
                if gap > max_gap_frames:
                    break
                continue
            if abs(midi[j] - pitch_ref) > 0.6:
                break
            gap = 0
            members.append(j)
            pitch_ref = float(np.median(midi[members]))
        onset = float(times[members[0]])
        offset = float(times[members[-1]]) + (times[1] - times[0] if n > 1 else 0.02)
        if offset - onset >= min_duration:
            pitch = int(round(float(np.median(midi[members]))))
            if 0 <= pitch <= 127:
                rms = float(np.median(energies[members]))
                velocity = int(np.clip(30 + 90 * min(1.0, rms / 0.3), 1, 127))
                # Confidence: how stable the pitch was across the note.
                stability = float(np.std(midi[members]))
                conf = float(np.clip(1.0 - stability / 0.6, 0.1, 1.0))
                events.append(NoteEvent(onset, offset, pitch, velocity, round(conf, 3), track))
        i = members[-1] + 1

    return events


def transcribe_mono(
    x: np.ndarray,
    sr: int,
    *,
    fmin: float = 60.0,
    fmax: float = 1200.0,
    track: str = "melody",
) -> NoteStream:
    """Full model-free pipeline: YIN -> segmentation -> NoteStream."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 2:
        x = x.mean(axis=0)
    frame, hop = 1024, 256
    times, f0, voiced = yin_track(x, sr, frame=frame, hop=hop, fmin=fmin, fmax=fmax)
    energies = _frame_rms(x, times, sr, frame)
    # Gate voicing on energy: silence isn't a note even if YIN finds periodicity.
    if energies.size:
        floor = max(1e-4, float(np.percentile(energies, 90)) * 0.05)
        voiced = voiced & (energies > floor)
    events = segment_notes(times, f0, voiced, energies, track=track)
    return NoteStream(tuple(events), source="dsp-yin")
