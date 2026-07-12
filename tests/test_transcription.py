import numpy as np

from neiro.dsp.pitch import transcribe_mono, yin_track
from neiro.engine.artifacts import NoteEvent, NoteStream
from neiro.symbolic import compile_timeline, merge_streams, quantize_stream, write_midi

SR = 16000


def _tone(freq, seconds, sr=SR, amp=0.5):
    t = np.arange(int(seconds * sr)) / sr
    # Gentle fade to avoid clicks/spectral splatter at note boundaries.
    x = amp * np.sin(2 * np.pi * freq * t)
    fade = min(len(x) // 10, 160)
    if fade:
        ramp = np.linspace(0, 1, fade)
        x[:fade] *= ramp
        x[-fade:] *= ramp[::-1]
    return x


def _melody():
    """C4 (261.63), E4 (329.63), G4 (392.00) — 0.5 s each with 0.1 s gaps."""
    gap = np.zeros(int(0.1 * SR))
    return np.concatenate(
        [
            _tone(261.63, 0.5),
            gap,
            _tone(329.63, 0.5),
            gap,
            _tone(392.00, 0.5),
            gap,
        ]
    ).astype(np.float32)


# ---- YIN --------------------------------------------------------------------


def test_yin_tracks_a440():
    x = _tone(440.0, 1.0)
    times, f0, voiced = yin_track(x, SR)
    hits = f0[voiced]
    assert hits.size > 10
    assert abs(np.median(hits) - 440.0) < 2.0


def test_yin_silence_is_unvoiced():
    x = np.zeros(SR)
    _, _, voiced = yin_track(x, SR)
    assert not voiced.any()


# ---- note segmentation ------------------------------------------------------


def test_transcribe_mono_melody():
    stream = transcribe_mono(_melody(), SR)
    pitches = [e.pitch for e in stream.events]
    assert pitches == [60, 64, 67]  # C4, E4, G4
    # Onsets roughly at 0, 0.6, 1.2.
    onsets = [e.onset for e in stream.events]
    for got, want in zip(onsets, [0.0, 0.6, 1.2], strict=True):
        assert abs(got - want) < 0.08
    assert all(e.confidence > 0.5 for e in stream.events)


# ---- quantization -----------------------------------------------------------


def test_quantize_is_reversible():
    events = (
        NoteEvent(0.03, 0.48, 60, 90),
        NoteEvent(0.52, 0.97, 64, 90),
    )
    stream = NoteStream(events)
    q, offsets = quantize_stream(stream, bpm=120, division=2)  # 0.25 s grid
    # Snapped onto the grid...
    assert abs(q.events[0].onset - 0.0) < 1e-9
    assert abs(q.events[1].onset - 0.5) < 1e-9
    # ...and adding the micro-offsets back reproduces the performance.
    for e, off, orig in zip(q.events, offsets, events, strict=True):
        assert abs((e.onset + off) - orig.onset) < 1e-6


def test_merge_deduplicates_cross_stream():
    a = NoteStream((NoteEvent(1.00, 1.5, 60, 80, confidence=0.9),), source="a")
    b = NoteStream(
        (
            NoteEvent(1.02, 1.5, 60, 70, confidence=0.4),
            NoteEvent(2.00, 2.5, 64, 80, confidence=0.8),
        ),
        source="b",
    )
    merged = merge_streams([a, b])
    assert len(merged.events) == 2
    kept = [e for e in merged.events if e.pitch == 60][0]
    assert kept.confidence == 0.9  # higher confidence won


# ---- MIDI writer ------------------------------------------------------------


def _parse_midi(data: bytes):
    """Micro-parser: return (n_tracks, ppq, note_on_count, tempo_us)."""
    assert data[:4] == b"MThd"
    fmt, n_tracks, ppq = (
        int.from_bytes(data[8:10], "big"),
        int.from_bytes(data[10:12], "big"),
        int.from_bytes(data[12:14], "big"),
    )
    assert fmt == 1
    pos, note_ons, tempo = 14, 0, None
    for _ in range(n_tracks):
        assert data[pos : pos + 4] == b"MTrk"
        length = int.from_bytes(data[pos + 4 : pos + 8], "big")
        body = data[pos + 8 : pos + 8 + length]
        i = 0
        while i < len(body):
            # variable-length delta
            while body[i] & 0x80:
                i += 1
            i += 1
            status = body[i]
            if status == 0xFF:
                meta_type = body[i + 1]
                meta_len = body[i + 2]
                if meta_type == 0x51:
                    tempo = int.from_bytes(body[i + 3 : i + 3 + 3], "big")
                i += 3 + meta_len
            elif status & 0xF0 == 0x90 and body[i + 2] > 0:
                note_ons += 1
                i += 3
            elif status & 0xF0 in (0x80, 0x90):
                i += 3
            else:
                raise AssertionError(f"unexpected status byte {status:#x}")
        pos += 8 + length
    return n_tracks, ppq, note_ons, tempo


def test_write_midi_roundtrip(tmp_path):
    stream = transcribe_mono(_melody(), SR)
    timeline = compile_timeline({"melody": stream}, bpm=100, quantize=True)
    path = write_midi(timeline, tmp_path / "out.mid")
    n_tracks, ppq, note_ons, tempo = _parse_midi(path.read_bytes())
    assert n_tracks == 2  # tempo track + melody
    assert ppq == 480
    assert note_ons == 3
    assert tempo == 600000  # 100 BPM


def test_timeline_compile_uses_bpm_and_stores_offsets():
    stream = NoteStream((NoteEvent(0.26, 0.49, 60, 80),))
    tl = compile_timeline({"m": stream}, bpm=120, quantize=True, division=4)
    assert tl.tempo_bpm == 120
    assert tl.total_events() == 1
    name, offsets = tl.micro_offsets[0]
    assert name == "m"
    q_onset = tl.get("m").events[0].onset
    assert abs(q_onset + offsets[0] - 0.26) < 1e-6
