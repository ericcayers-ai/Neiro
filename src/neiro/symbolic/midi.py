"""Standard MIDI File writer (format 1), dependency-free.

Track 0 carries tempo and time signature; each Timeline track becomes one MIDI
track on its own channel (drums would map to channel 9; melody tracks cycle
through the rest). Onsets/offsets in seconds are converted to ticks through the
timeline's tempo.
"""

from __future__ import annotations

import struct
from pathlib import Path

from neiro.engine.artifacts import NoteEvent, NoteStream, Timeline

__all__ = ["write_midi", "read_midi_notes", "PPQ"]

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


def _read_varlen(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    while True:
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            break
    return value, pos


def read_midi_notes(path: str | Path, *, track: str = "midi") -> NoteStream:
    """Read a Standard MIDI File back into a :class:`NoteStream`, in seconds.

    Dependency-free counterpart to :func:`write_midi`, used to round-trip
    output from CLI-based adapters (e.g. Transkun) that only speak MIDI.
    Merges all tracks/channels; percussion (channel 9) events are tagged with
    ``"{track}.drums"``, everything else with ``track``. Tempo-map aware: uses
    each track's own tempo meta-events (falling back to 120 BPM) to convert
    ticks to seconds, so multi-tempo files still land on the right onset.
    """
    data = Path(path).read_bytes()
    if data[:4] != b"MThd":
        raise ValueError("not a Standard MIDI File")
    _fmt, n_tracks, ppq = struct.unpack(">HHH", data[8:14])
    pos = 14

    events: list[NoteEvent] = []
    for _ in range(n_tracks):
        if data[pos : pos + 4] != b"MTrk":
            raise ValueError("malformed MIDI: expected MTrk")
        length = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        end = pos + 8 + length
        p = pos + 8

        tick = 0
        seconds = 0.0
        us_per_qn = 500_000  # default 120 BPM
        last_tick_at_tempo = 0
        running_status = 0
        pending: dict[tuple[int, int], tuple[float, int]] = {}  # (channel,pitch)->(onset_s,vel)

        def tick_to_seconds(t: int) -> float:
            return seconds + (t - last_tick_at_tempo) * (us_per_qn / ppq) / 1_000_000

        while p < end:
            delta, p = _read_varlen(data, p)
            tick += delta
            status = data[p]
            if status < 0x80:  # running status
                status = running_status
            else:
                p += 1
                running_status = status
            if status == 0xFF:  # meta
                meta_type = data[p]
                meta_len, p2 = _read_varlen(data, p + 1)
                payload = data[p2 : p2 + meta_len]
                if meta_type == 0x51 and meta_len == 3:
                    seconds = tick_to_seconds(tick)
                    last_tick_at_tempo = tick
                    us_per_qn = int.from_bytes(payload, "big")
                p = p2 + meta_len
            elif status in (0xF0, 0xF7):  # sysex
                sys_len, p2 = _read_varlen(data, p)
                p = p2 + sys_len
            else:
                hi = status & 0xF0
                channel = status & 0x0F
                if hi in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                    d1, d2 = data[p], data[p + 1]
                    p += 2
                elif hi in (0xC0, 0xD0):
                    d1, d2 = data[p], 0
                    p += 1
                else:
                    d1, d2 = 0, 0
                t_s = tick_to_seconds(tick)
                if hi == 0x90 and d2 > 0:  # note on
                    pending[(channel, d1)] = (t_s, d2)
                elif hi == 0x80 or (hi == 0x90 and d2 == 0):  # note off
                    key = (channel, d1)
                    if key in pending:
                        onset, vel = pending.pop(key)
                        name = f"{track}.drums" if channel == 9 else track
                        events.append(
                            NoteEvent(
                                onset=round(onset, 6),
                                offset=round(max(t_s, onset + 1e-4), 6),
                                pitch=d1,
                                velocity=vel,
                                track=name,
                            )
                        )
        pos = end

    events.sort(key=lambda e: (e.onset, e.pitch))
    return NoteStream(tuple(events), source="midi-import")
