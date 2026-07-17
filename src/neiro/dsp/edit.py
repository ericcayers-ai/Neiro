"""Non-destructive edit operations for the built-in audio editor (roadmap §9.1).

Every function takes an :class:`AudioTensor` and returns a new one — the input is
never mutated, matching the roadmap's non-destructive principle (nothing edits the
source; edits produce new artifacts). Regions are given in seconds and clamped to
the signal bounds, so out-of-range selections degrade gracefully rather than
raising.
"""

from __future__ import annotations

import numpy as np

from neiro.dsp.enhance import peak_normalize
from neiro.engine.artifacts import AudioTensor

__all__ = [
    "trim",
    "delete_region",
    "silence_region",
    "gain",
    "fade",
    "reverse",
    "normalize",
    "bounce",
    "split_at",
    "time_stretch",
    "pitch_shift",
    "pitch_correct",
]


def _clamp(audio: AudioTensor, start_s: float, end_s: float) -> tuple[int, int]:
    a = max(0, min(audio.frames, int(round(start_s * audio.sample_rate))))
    b = max(0, min(audio.frames, int(round(end_s * audio.sample_rate))))
    if b < a:
        a, b = b, a
    return a, b


def trim(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Keep only the region [start_s, end_s); discard the rest."""
    a, b = _clamp(audio, start_s, end_s)
    return AudioTensor(audio.samples[:, a:b].copy(), audio.sample_rate).with_provenance(
        f"trim({start_s:.3f},{end_s:.3f})"
    )


def delete_region(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Remove the region [start_s, end_s), splicing the surrounding audio."""
    a, b = _clamp(audio, start_s, end_s)
    kept = np.concatenate([audio.samples[:, :a], audio.samples[:, b:]], axis=1)
    return AudioTensor(kept.copy(), audio.sample_rate).with_provenance(
        f"delete({start_s:.3f},{end_s:.3f})"
    )


def silence_region(audio: AudioTensor, start_s: float, end_s: float) -> AudioTensor:
    """Zero the region [start_s, end_s) in place-length (keeps duration)."""
    a, b = _clamp(audio, start_s, end_s)
    out = audio.samples.copy()
    out[:, a:b] = 0.0
    return AudioTensor(out, audio.sample_rate).with_provenance(
        f"silence({start_s:.3f},{end_s:.3f})"
    )


def gain(
    audio: AudioTensor, db: float, start_s: float | None = None, end_s: float | None = None
) -> AudioTensor:
    """Apply ``db`` gain, to a region if given, else the whole signal."""
    factor = 10 ** (db / 20.0)
    out = audio.samples.copy()
    if start_s is None or end_s is None:
        out *= factor
    else:
        a, b = _clamp(audio, start_s, end_s)
        out[:, a:b] *= factor
    return AudioTensor(out.astype(np.float32), audio.sample_rate).with_provenance(
        f"gain({db:+.1f}dB)"
    )


def fade(audio: AudioTensor, start_s: float, end_s: float, *, direction: str = "in") -> AudioTensor:
    """Apply a linear fade in or out across [start_s, end_s)."""
    a, b = _clamp(audio, start_s, end_s)
    out = audio.samples.copy()
    n = b - a
    if n > 0:
        ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
        if direction == "out":
            ramp = ramp[::-1]
        out[:, a:b] *= ramp
    return AudioTensor(out, audio.sample_rate).with_provenance(f"fade-{direction}")


def reverse(audio: AudioTensor) -> AudioTensor:
    """Reverse the signal in time."""
    return AudioTensor(audio.samples[:, ::-1].copy(), audio.sample_rate).with_provenance("reverse")


def normalize(audio: AudioTensor, target_dbfs: float = -1.0) -> AudioTensor:
    """Peak-normalize to ``target_dbfs``."""
    return AudioTensor(
        peak_normalize(audio.samples, target_dbfs), audio.sample_rate
    ).with_provenance(f"normalize({target_dbfs:+.1f}dBFS)")


def split_at(audio: AudioTensor, at_s: float) -> tuple[AudioTensor, AudioTensor]:
    """Split ``audio`` at ``at_s`` into (left, right) buffers."""
    at_s = max(0.0, min(audio.duration_seconds, float(at_s)))
    left = trim(audio, 0.0, at_s)
    right = trim(audio, at_s, audio.duration_seconds)
    return (
        left.with_provenance(f"split-left@{at_s:.3f}"),
        right.with_provenance(f"split-right@{at_s:.3f}"),
    )


def _to_stereo(samples: np.ndarray) -> np.ndarray:
    if samples.shape[0] == 1:
        return np.vstack([samples, samples])
    if samples.shape[0] >= 2:
        return samples[:2]
    return samples


def _try_rubberband(
    samples: np.ndarray, sr: int, *, tempo: float = 1.0, pitch: float = 0.0
) -> np.ndarray | None:
    """Call the ``rubberband`` CLI when installed. ``tempo`` is playback speed (1=unchanged)."""
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    from neiro.util import subprocess_win

    if not shutil.which("rubberband"):
        return None
    if abs(tempo - 1.0) < 1e-6 and abs(pitch) < 1e-6:
        return samples.copy()

    try:
        import soundfile as sf
    except ImportError:
        return None

    with tempfile.TemporaryDirectory(prefix="neiro-rb-") as tmp:
        src = Path(tmp) / "in.wav"
        dst = Path(tmp) / "out.wav"
        sf.write(str(src), samples.T, sr, subtype="FLOAT")
        cmd = ["rubberband", "-q"]
        if abs(tempo - 1.0) >= 1e-6:
            cmd += ["--tempo", f"{tempo:.6f}"]
        if abs(pitch) >= 1e-6:
            cmd += ["--pitch", f"{pitch:.6f}"]
        cmd += [str(src), str(dst)]
        try:
            subprocess_win.run(cmd, check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError):
            return None
        if not dst.exists():
            return None
        data, out_sr = sf.read(str(dst), always_2d=True)
        if int(out_sr) != sr:
            from scipy import signal as sps

            n = int(round(data.shape[0] * sr / out_sr))
            data = sps.resample(data, n, axis=0)
        return data.T.astype(np.float32)


def _phase_vocoder_stretch(
    mono: np.ndarray, rate: float, n_fft: int = 2048, hop: int = 512
) -> np.ndarray:
    """Simple STFT phase-vocoder time stretch. ``rate`` > 1 lengthens (slower)."""
    from neiro.dsp.separation import istft, stft

    if abs(rate - 1.0) < 1e-6:
        return mono.copy()
    if rate <= 0:
        raise ValueError("stretch rate must be positive")

    S = stft(mono.astype(np.float64), n_fft=n_fft, hop=hop)
    n_bins, n_frames = S.shape
    # Output frame count scales with rate (longer when rate > 1).
    out_frames = max(1, int(round(n_frames * rate)))
    # Time-map: output frame j reads from source frame j / rate
    mag = np.abs(S)
    phase = np.angle(S)
    out = np.zeros((n_bins, out_frames), dtype=np.complex128)
    # Expected phase advance per hop for each bin
    freq = np.arange(n_bins) * 2.0 * np.pi * hop / n_fft
    phase_acc = phase[:, 0].copy()
    out[:, 0] = mag[:, 0] * np.exp(1j * phase_acc)
    last_src = 0
    for j in range(1, out_frames):
        src_f = j / rate
        i0 = int(np.floor(src_f))
        i1 = min(n_frames - 1, i0 + 1)
        frac = src_f - i0
        i0 = min(i0, n_frames - 1)
        m = (1.0 - frac) * mag[:, i0] + frac * mag[:, i1]
        # Phase advance from consecutive source frames when we step forward
        src_i = min(n_frames - 1, int(round(src_f)))
        if src_i != last_src and last_src < n_frames:
            delta = phase[:, src_i] - phase[:, last_src]
            delta = delta - 2.0 * np.pi * np.round(delta / (2.0 * np.pi))
            # Prefer bin-wise expected advance when source skipped frames
            steps = max(1, src_i - last_src)
            phase_acc = phase_acc + delta / steps * steps
            # Blend with locked oscillator for stability
            phase_acc = phase_acc + (freq - freq)  # no-op keep shape
            phase_acc = phase_acc + delta
            last_src = src_i
        else:
            phase_acc = phase_acc + freq
        out[:, j] = m * np.exp(1j * phase_acc)
    target_len = int(round(len(mono) * rate))
    return istft(out, n_fft=n_fft, hop=hop, length=target_len).astype(np.float32)


def _resample_stretch(samples: np.ndarray, rate: float) -> np.ndarray:
    """Fallback: linear resample (changes pitch with tempo)."""
    from scipy import signal as sps

    if abs(rate - 1.0) < 1e-6:
        return samples.copy()
    n = max(1, int(round(samples.shape[1] * rate)))
    return sps.resample(samples, n, axis=1).astype(np.float32)


def time_stretch(audio: AudioTensor, rate: float) -> AudioTensor:
    """Pitch-preserving time stretch when possible.

    ``rate`` is a *duration* scale: ``rate > 1`` makes the clip longer (slower).
    For BPM alignment use ``rate = source_bpm / target_bpm``.

    Prefers the ``rubberband`` CLI; falls back to an STFT phase vocoder, then
    plain resample (pitch shifts — noted in provenance).
    """
    rate = float(rate)
    if rate <= 0:
        raise ValueError("time_stretch rate must be positive")
    if abs(rate - 1.0) < 1e-6:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "time_stretch(1)"
        )

    # rubberband --tempo is playback speed: tempo=0.5 → twice as long → rate=2 → tempo=1/rate
    rb = _try_rubberband(audio.samples, audio.sample_rate, tempo=1.0 / rate)
    if rb is not None:
        return AudioTensor(rb, audio.sample_rate).with_provenance(
            f"time_stretch({rate:.4f},rubberband)"
        )

    try:
        channels = []
        for ch in range(audio.samples.shape[0]):
            channels.append(_phase_vocoder_stretch(audio.samples[ch], rate))
        # Align channel lengths
        n = min(c.shape[0] for c in channels)
        out = np.stack([c[:n] for c in channels], axis=0)
        return AudioTensor(out, audio.sample_rate).with_provenance(
            f"time_stretch({rate:.4f},phase-vocoder)"
        )
    except Exception:
        out = _resample_stretch(audio.samples, rate)
        return AudioTensor(out, audio.sample_rate).with_provenance(
            f"time_stretch({rate:.4f},resample-pitch-shift)"
        )


def pitch_shift(audio: AudioTensor, semitones: float) -> AudioTensor:
    """Shift pitch by ``semitones`` without changing duration (when rubberband/PV available)."""
    semitones = float(semitones)
    if abs(semitones) < 1e-6:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_shift(0)"
        )

    rb = _try_rubberband(audio.samples, audio.sample_rate, tempo=1.0, pitch=semitones)
    if rb is not None:
        # rubberband keeps duration; trim/pad to original length if needed
        n = audio.samples.shape[1]
        if rb.shape[1] > n:
            rb = rb[:, :n]
        elif rb.shape[1] < n:
            pad = np.zeros((rb.shape[0], n - rb.shape[1]), dtype=np.float32)
            rb = np.concatenate([rb, pad], axis=1)
        return AudioTensor(rb, audio.sample_rate).with_provenance(
            f"pitch_shift({semitones:+.2f},rubberband)"
        )

    # Stretch then resample back: rate = 2^(s/12) for pitch up → shorter intermediate
    factor = 2.0 ** (semitones / 12.0)
    stretched = time_stretch(audio, 1.0 / factor)
    # Resample stretched buffer back to original duration
    from scipy import signal as sps

    n = audio.samples.shape[1]
    out = sps.resample(stretched.samples, n, axis=1).astype(np.float32)
    return AudioTensor(out, audio.sample_rate).with_provenance(
        f"pitch_shift({semitones:+.2f},pv+resample)"
    )


_NOTE_PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)


def _parse_key_scale(key: str | None) -> list[int] | None:
    """Return pitch-class set for ``key`` (e.g. ``C``, ``Am``, ``F# minor``), or None for chromatic."""
    if not key or not str(key).strip():
        return None
    raw = str(key).strip().lower().replace("major", "").replace("maj", "").strip()
    minor = "min" in raw or raw.endswith("m") and not raw.endswith("am") and len(raw) > 1
    # Common forms: "a minor", "am", "a-m", "amin"
    token = raw.replace("minor", "").replace("min", "").replace("-", "").strip()
    if token.endswith("m") and len(token) <= 3:
        minor = True
        token = token[:-1]
    if not token:
        return None
    root_ch = token[0]
    if root_ch not in _NOTE_PC:
        return None
    pc = _NOTE_PC[root_ch]
    rest = token[1:]
    if rest.startswith("#") or rest.startswith("♯"):
        pc = (pc + 1) % 12
    elif rest.startswith("b") or rest.startswith("♭"):
        pc = (pc - 1) % 12
    degrees = _MINOR_SCALE if minor else _MAJOR_SCALE
    return [(pc + d) % 12 for d in degrees]


def _snap_midi(midi: float, scale_pcs: list[int] | None) -> float:
    """Snap a continuous MIDI number to nearest chromatic or scale degree (same octave)."""
    if scale_pcs is None:
        return float(round(midi))
    octave = int(np.floor(midi / 12.0))
    pc = midi - octave * 12.0
    best = scale_pcs[0]
    best_dist = 99.0
    for candidate in scale_pcs:
        # Nearest including octave wrap
        for delta in (-12, 0, 12):
            d = abs((candidate + delta) - pc)
            if d < best_dist:
                best_dist = d
                best = candidate + delta
    return float(octave * 12 + best)


def pitch_correct(
    audio: AudioTensor,
    *,
    key: str | None = None,
    strength: float = 1.0,
) -> AudioTensor:
    """Corrective pitch snap for suitable mono / near-mono material (Autotone-class).

    Tracks f0 with YIN, groups voiced frames into notes, snaps each note to the
    nearest chromatic (or ``key`` scale degree), then applies per-note
    :func:`pitch_shift` (Rubber Band CLI when available, else PV+resample).

    Stereo inputs are analyzed from a mono mix; the same semitone shifts are
    applied to every channel so imaging is preserved. Returns a copy with a
    skip provenance note when little/no voiced content is found.
    """
    strength = float(np.clip(strength, 0.0, 1.0))
    if strength < 1e-6:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_correct(strength=0)"
        )

    from neiro.dsp.pitch import segment_notes, yin_track

    mono = np.mean(audio.samples, axis=0).astype(np.float64)
    # Near-silence / extremely short buffers: nothing to correct.
    if mono.size < audio.sample_rate * 0.15 or float(np.max(np.abs(mono))) < 1e-6:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_correct(skip:too-short)"
        )

    try:
        times, f0, voiced = yin_track(mono, audio.sample_rate)
    except ValueError:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_correct(skip:yin-failed)"
        )

    if not np.any(voiced):
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_correct(skip:unvoiced)"
        )

    # Frame energies for segment_notes velocity (unused for correction itself).
    energies = np.zeros(len(times), dtype=np.float64)
    frame = 1024
    for i, t in enumerate(times):
        c = int(t * audio.sample_rate)
        seg = mono[max(0, c - frame // 2) : c + frame // 2]
        energies[i] = float(np.sqrt(np.mean(seg**2))) if seg.size else 0.0

    events = segment_notes(times, f0, voiced, energies, min_duration=0.05)
    if not events:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            "pitch_correct(skip:no-notes)"
        )

    scale = _parse_key_scale(key)
    out = audio.samples.copy().astype(np.float32)
    n_corrected = 0
    total_cents = 0.0

    for ev in events:
        # Median continuous MIDI over the note's voiced frames
        mask = (times >= ev.onset) & (times <= ev.offset) & voiced & (f0 > 0)
        if not np.any(mask):
            continue
        midi_vals = 69.0 + 12.0 * np.log2(np.maximum(f0[mask], 1e-6) / 440.0)
        median_midi = float(np.median(midi_vals))
        target = _snap_midi(median_midi, scale)
        delta = (target - median_midi) * strength
        if abs(delta) < 0.02:
            continue

        a = max(0, int(round(ev.onset * audio.sample_rate)))
        b = min(audio.frames, int(round(ev.offset * audio.sample_rate)))
        if b - a < int(0.03 * audio.sample_rate):
            continue

        region = AudioTensor(out[:, a:b].copy(), audio.sample_rate)
        shifted = pitch_shift(region, delta)
        chunk = shifted.samples
        # Match region length (pitch_shift aims to preserve duration).
        n = b - a
        if chunk.shape[1] > n:
            chunk = chunk[:, :n]
        elif chunk.shape[1] < n:
            pad = np.zeros((chunk.shape[0], n - chunk.shape[1]), dtype=np.float32)
            chunk = np.concatenate([chunk, pad], axis=1)
        # Match channel count
        if chunk.shape[0] != out.shape[0]:
            if chunk.shape[0] == 1 and out.shape[0] >= 2:
                chunk = np.vstack([chunk, chunk])[: out.shape[0]]
            else:
                chunk = chunk[: out.shape[0]]
        out[:, a:b] = chunk
        n_corrected += 1
        total_cents += abs(delta) * 100.0

    key_tag = f",key={key}" if key else ",chromatic"
    if n_corrected == 0:
        return AudioTensor(audio.samples.copy(), audio.sample_rate).with_provenance(
            f"pitch_correct(skip:already-in-tune{key_tag})"
        )
    avg_cents = total_cents / max(1, n_corrected)
    return AudioTensor(out, audio.sample_rate).with_provenance(
        f"pitch_correct(notes={n_corrected},avg_cents={avg_cents:.0f}{key_tag})"
    )


def bounce(
    layers: list[tuple[AudioTensor, float, float, float]],
    *,
    sample_rate: int | None = None,
) -> AudioTensor:
    """Mix layers of ``(audio, gain_linear, pan[-1..1], offset_s)`` into stereo.

    Constant-power pan; offsets pad the start of each layer. Empty ``layers``
    yields 0.1 s of silence at 48 kHz (or ``sample_rate``).
    """
    if not layers:
        sr = sample_rate or 48000
        return AudioTensor(np.zeros((2, int(0.1 * sr)), dtype=np.float32), sr).with_provenance(
            "bounce(empty)"
        )

    sr = sample_rate or layers[0][0].sample_rate
    end_frames = 0
    prepared: list[tuple[np.ndarray, int]] = []
    for audio, gain_lin, pan, offset_s in layers:
        if audio.sample_rate != sr:
            raise ValueError(f"bounce sample-rate mismatch: got {audio.sample_rate}, expected {sr}")
        stereo = _to_stereo(audio.samples).astype(np.float32, copy=True)
        g = float(gain_lin)
        p = max(-1.0, min(1.0, float(pan)))
        # Constant-power: pan -1 = full L, +1 = full R
        angle = (p + 1.0) * (np.pi / 4.0)
        l_gain = g * float(np.cos(angle))
        r_gain = g * float(np.sin(angle))
        stereo[0] *= l_gain
        stereo[1] *= r_gain
        off = max(0, int(round(float(offset_s) * sr)))
        prepared.append((stereo, off))
        end_frames = max(end_frames, off + stereo.shape[1])

    out = np.zeros((2, end_frames), dtype=np.float32)
    for stereo, off in prepared:
        n = stereo.shape[1]
        out[:, off : off + n] += stereo
    peak = float(np.max(np.abs(out))) if end_frames else 0.0
    if peak > 1.0:
        out /= peak
    return AudioTensor(out, sr).with_provenance(f"bounce({len(layers)} layers)")
