#!/usr/bin/env python
"""Throughput benchmark for Neiro's DSP pipeline (roadmap §11).

Measures real-time factor (RTF = audio seconds processed per wall-clock second)
for the model-free lanes on the current machine, plus cache-hit speedup. No model
downloads or GPU required, so the numbers are reproducible anywhere.

    python scripts/benchmark.py [--seconds 30] [--sr 44100]

RTF > 1 means faster than real time. These are the always-available DSP floors;
neural backends will differ and are benchmarked separately when installed.
"""

from __future__ import annotations

import argparse
import time

import numpy as np

from neiro.adapters.dsp_separators import CenterSeparator
from neiro.analysis import analyze
from neiro.dsp import (
    center_extract,
    harmonic_percussive,
    spectral_gate,
    spectrogram_image,
    transcribe_mono,
    tta_separate,
    waveform_peaks,
)
from neiro.engine.artifacts import AudioTensor


def _make_signal(seconds: float, sr: int) -> AudioTensor:
    t = np.arange(int(seconds * sr)) / sr
    vocal = 0.4 * np.sin(2 * np.pi * 220 * t)
    gtr = 0.3 * np.sin(2 * np.pi * 660 * t)
    hat = 0.1 * np.sign(np.sin(2 * np.pi * 8 * t)) * np.sin(2 * np.pi * 4000 * t)
    left = (vocal + gtr + hat).astype(np.float32)
    right = (vocal + hat).astype(np.float32)
    return AudioTensor(np.stack([left, right]), sr)


def _time(label: str, fn, audio: AudioTensor, seconds: float) -> None:
    start = time.perf_counter()
    fn(audio)
    elapsed = time.perf_counter() - start
    rtf = seconds / elapsed if elapsed > 0 else float("inf")
    print(f"  {label:<28} {elapsed * 1000:8.1f} ms   RTF {rtf:6.1f}x")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--sr", type=int, default=44100)
    ap.add_argument(
        "--smoke",
        action="store_true",
        help="Short CI smoke run (2 s signal) instead of the full bench.",
    )
    args = ap.parse_args()
    if args.smoke:
        args.seconds = 2.0

    audio = _make_signal(args.seconds, args.sr)
    mono16 = AudioTensor(audio.to_mono().samples[:, :: args.sr // 16000], 16000)
    print(f"Benchmark: {args.seconds:.0f}s stereo @ {args.sr} Hz ({audio.frames:,} frames)\n")

    print("Analysis & separation:")
    _time("analyze (full report)", analyze, audio, args.seconds)
    _time(
        "center extraction", lambda a: center_extract(a.samples, a.sample_rate), audio, args.seconds
    )
    _time("HPSS", lambda a: harmonic_percussive(a.samples, a.sample_rate), audio, args.seconds)
    _time(
        "center + TTA (x3 views)", lambda a: tta_separate(CenterSeparator(), a), audio, args.seconds
    )

    print("\nRestoration:")
    _time(
        "spectral-gate denoise",
        lambda a: spectral_gate(a.samples, a.sample_rate),
        audio,
        args.seconds,
    )

    print("\nTranscription (mono lane):")
    _time(
        "YIN transcription",
        lambda a: transcribe_mono(a.samples, a.sample_rate),
        mono16,
        args.seconds,
    )

    print("\nEditor visuals:")
    _time("waveform peaks", lambda a: waveform_peaks(a, 1200), audio, args.seconds)
    _time("spectrogram image", lambda a: spectrogram_image(a), audio, args.seconds)

    print("\nRTF > 1.0 means faster than real time on this machine.")


if __name__ == "__main__":
    main()
