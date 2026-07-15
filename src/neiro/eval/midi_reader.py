"""Minimal Standard MIDI File reader, dependency-free — the mirror image of
:mod:`neiro.symbolic.midi`'s writer.

Only used by the evaluation harness to load ground-truth note events (e.g. from
MAESTRO's per-performance ``.midi`` files) into the same
:class:`~neiro.engine.artifacts.NoteEvent` shape the engine and
:mod:`neiro.eval.metrics` already speak — no new "ground truth format" to
maintain. Handles PPQ-division format 0/1 files with running status and
tempo-map changes; SMPTE-division files (rare, video-post use case) raise a
clear :class:`NotImplementedError` rather than silently mis-timing notes.
"""

from __future__ import annotations

import struct
from pathlib import Path

from neiro.engine.artifacts import NoteEvent

__all__ = ["read_midi_notes"]


def _read_varlen(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    while True:
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            break
    return value, pos


def _parse_tracks(data: bytes) -> tuple[int, list[list[tuple[int, bytes]]]]:
    if data[0:4] != b"MThd":
        raise ValueError("not a Standard MIDI File (missing MThd)")
    header_len = struct.unpack(">I", data[4:8])[0]
    _fmt, ntrks, division = struct.unpack(">HHH", data[8 : 8 + 6])
    if division & 0x8000:
        raise NotImplementedError("SMPTE time division MIDI files are not supported")
    pos = 8 + header_len
    tracks: list[list[tuple[int, bytes]]] = []
    for _ in range(ntrks):
        if data[pos : pos + 4] != b"MTrk":
            raise ValueError(f"expected MTrk chunk at byte {pos}")
        track_len = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        track_end = pos + 8 + track_len
        pos += 8
        events: list[tuple[int, bytes]] = []
        tick = 0
        running_status: int | None = None
        while pos < track_end:
            delta, pos = _read_varlen(data, pos)
            tick += delta
            status = data[pos]
            if status < 0x80:
                # Running status: reuse the previous status byte, this byte is data.
                if running_status is None:
                    raise ValueError("running status with no prior status byte")
                status = running_status
            else:
                pos += 1
                if status != 0xFF and status < 0xF0:
                    running_status = status
            if status == 0xFF:  # meta event
                meta_type = data[pos]
                pos += 1
                length, pos = _read_varlen(data, pos)
                payload = data[pos : pos + length]
                pos += length
                events.append((tick, bytes([0xFF, meta_type]) + payload))
            elif status in (0xF0, 0xF7):  # sysex
                length, pos = _read_varlen(data, pos)
                pos += length
            else:
                kind = status & 0xF0
                n_data = 1 if kind in (0xC0, 0xD0) else 2
                payload = data[pos : pos + n_data]
                pos += n_data
                events.append((tick, bytes([status]) + payload))
        tracks.append(events)
        pos = track_end
    return division, tracks


def _tempo_map(tracks: list[list[tuple[int, bytes]]]) -> list[tuple[int, int]]:
    """``[(tick, microseconds_per_quarter), ...]`` sorted by tick, tick 0 defaulted."""
    changes: list[tuple[int, int]] = []
    for track in tracks:
        for tick, msg in track:
            if msg[0] == 0xFF and msg[1] == 0x51 and len(msg) >= 5:
                us = (msg[2] << 16) | (msg[3] << 8) | msg[4]
                changes.append((tick, us))
    changes.sort()
    if not changes or changes[0][0] != 0:
        changes.insert(0, (0, 500_000))  # default 120 BPM
    # Collapse duplicate ticks (last write wins), keep monotonically increasing ticks.
    dedup: list[tuple[int, int]] = []
    for tick, us in changes:
        if dedup and dedup[-1][0] == tick:
            dedup[-1] = (tick, us)
        else:
            dedup.append((tick, us))
    return dedup


def _make_tick_to_seconds(tempo_map: list[tuple[int, int]], division: int):
    # Precompute cumulative seconds at each tempo-change tick.
    cum_seconds = [0.0]
    for i in range(1, len(tempo_map)):
        prev_tick, prev_us = tempo_map[i - 1]
        tick, _us = tempo_map[i]
        seconds = (tick - prev_tick) * prev_us / 1_000_000.0 / division
        cum_seconds.append(cum_seconds[-1] + seconds)

    def convert(target_tick: int) -> float:
        # Find the last tempo segment starting at or before target_tick.
        idx = 0
        for i, (tick, _us) in enumerate(tempo_map):
            if tick <= target_tick:
                idx = i
            else:
                break
        seg_tick, seg_us = tempo_map[idx]
        return cum_seconds[idx] + (target_tick - seg_tick) * seg_us / 1_000_000.0 / division

    return convert


def read_midi_notes(path: str | Path) -> tuple[NoteEvent, ...]:
    """Read every note in every track of a Standard MIDI File as absolute-time
    :class:`NoteEvent`s (seconds), tagged ``track="ch{n}"`` by MIDI channel.
    Percussion channel (9, 0-indexed) notes are tagged ``track="drums"``.
    """
    data = Path(path).read_bytes()
    division, tracks = _parse_tracks(data)
    tempo_map = _tempo_map(tracks)
    tick_to_seconds = _make_tick_to_seconds(tempo_map, division)

    events: list[NoteEvent] = []
    active: dict[tuple[int, int], list[tuple[int, int]]] = {}  # (channel, pitch) -> [(tick, vel)]
    for track in tracks:
        for tick, msg in track:
            status = msg[0]
            kind = status & 0xF0
            channel = status & 0x0F
            if kind == 0x90 and len(msg) >= 3 and msg[2] > 0:
                active.setdefault((channel, msg[1]), []).append((tick, msg[2]))
            elif kind == 0x80 or (kind == 0x90 and len(msg) >= 3 and msg[2] == 0):
                pitch = msg[1]
                stack = active.get((channel, pitch))
                if not stack:
                    continue
                on_tick, vel = stack.pop(0)
                onset = tick_to_seconds(on_tick)
                offset = tick_to_seconds(tick)
                track_name = "drums" if channel == 9 else f"ch{channel}"
                events.append(
                    NoteEvent(
                        onset=round(onset, 6),
                        offset=round(max(offset, onset + 1e-4), 6),
                        pitch=pitch,
                        velocity=vel,
                        track=track_name,
                    )
                )
    events.sort(key=lambda e: (e.onset, e.pitch))
    return tuple(events)
