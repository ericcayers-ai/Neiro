"""Standard MIDI File writer (format 1), dependency-free.

Track 0 carries tempo and time signature; each Timeline track becomes one MIDI
track on its own channel (drums would map to channel 9; melody tracks cycle
through the rest). Onsets/offsets in seconds are converted to ticks through the
timeline's tempo.
"""

from __future__ import annotations

import struct
from pathlib import Path

from neiro.engine.artifacts import NoteStream, Timeline

__all__ = ["write_midi", "PPQ"]

PPQ = 480  # ticks per quarter note


def _varlen(value: int) -> bytes:
    """MIDI variable-length quantity encoding."""
    if value < 0:
        raise ValueError("negative delta time")
    buf = [value & 0x7F]
    value >>= 7
    while value:
        buf.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(buf))


def _chunk(tag: bytes, payload: bytes) -> bytes:
    return tag + struct.pack(">I", len(payload)) + payload


def _tempo_track(bpm: float, name: str = "") -> bytes:
    us_per_quarter = int(round(60_000_000 / max(bpm, 1e-6)))
    ev = b""
    if name:
        nm = name.encode("utf-8")[:127]
        ev += _varlen(0) + b"\xff\x03" + _varlen(len(nm)) + nm
    ev += _varlen(0) + b"\xff\x51\x03" + struct.pack(">I", us_per_quarter)[1:]
    ev += _varlen(0) + b"\xff\x58\x04" + bytes([4, 2, 24, 8])  # 4/4
    ev += _varlen(0) + b"\xff\x2f\x00"  # end of track
    return _chunk(b"MTrk", ev)


def _note_track(stream: NoteStream, channel: int, bpm: float, name: str = "") -> bytes:
    ticks_per_second = PPQ * bpm / 60.0
    # Build absolute-tick event list: (tick, order, message). Offs before ons at
    # the same tick so re-struck notes aren't cancelled.
    msgs: list[tuple[int, int, bytes]] = []
    for e in stream.events:
        on_tick = max(0, int(round(e.onset * ticks_per_second)))
        off_tick = max(on_tick + 1, int(round(e.offset * ticks_per_second)))
        vel = max(1, min(127, e.velocity))
        pitch = max(0, min(127, e.pitch))
        msgs.append((on_tick, 1, bytes([0x90 | channel, pitch, vel])))
        msgs.append((off_tick, 0, bytes([0x80 | channel, pitch, 0])))
    msgs.sort(key=lambda m: (m[0], m[1]))

    ev = b""
    if name:
        nm = name.encode("utf-8")[:127]
        ev += _varlen(0) + b"\xff\x03" + _varlen(len(nm)) + nm
    prev = 0
    for tick, _order, msg in msgs:
        ev += _varlen(tick - prev) + msg
        prev = tick
    ev += _varlen(0) + b"\xff\x2f\x00"
    return _chunk(b"MTrk", ev)


_DRUM_HINTS = ("drum", "drums", "percussion", "perc", "kit")


def write_midi(timeline: Timeline, path: str | Path) -> Path:
    """Write a Timeline as a format-1 SMF. Returns the written path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    tracks = [_tempo_track(timeline.tempo_bpm, name="neiro")]
    melodic_channel = 0
    for name, stream in timeline.tracks:
        if any(h in name.lower() for h in _DRUM_HINTS):
            channel = 9  # GM percussion
        else:
            channel = melodic_channel
            melodic_channel += 1
            if melodic_channel == 9:  # skip the percussion channel
                melodic_channel += 1
            melodic_channel %= 16
        tracks.append(_note_track(stream, channel, timeline.tempo_bpm, name=name))

    header = _chunk(b"MThd", struct.pack(">HHH", 1, len(tracks), PPQ))
    path.write_bytes(header + b"".join(tracks))
    return path
