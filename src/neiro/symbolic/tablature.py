"""ASCII tablature export for guitar/bass (roadmap §7.3 "tab assignment").

Assigns each note a (string, fret) pair via dynamic programming over a
playability cost — fret span from the previous position, with a mild bias
toward the open-string / low-fret end of the neck — then renders the standard
plain-text tab layout (one row per string, frets between ``|`` bars).

Tuning is a list of open-string MIDI pitches, lowest string first (index 0).
Standard guitar: E2 A2 D3 G3 B3 E4 = ``[40, 45, 50, 55, 59, 64]``. Standard
4-string bass: E1 A1 D2 G2 = ``[28, 33, 38, 43]``.
"""

from __future__ import annotations

from pathlib import Path

from neiro.engine.artifacts import NoteEvent, NoteStream

__all__ = ["assign_tab", "render_ascii_tab", "write_tablature", "GUITAR_STANDARD", "BASS_STANDARD"]

GUITAR_STANDARD: tuple[int, ...] = (40, 45, 50, 55, 59, 64)
BASS_STANDARD: tuple[int, ...] = (28, 33, 38, 43)

_STRING_LABELS_GUITAR = ["E", "A", "D", "G", "B", "e"]
_STRING_LABELS_BASS = ["E", "A", "D", "G"]


def assign_tab(
    events: tuple[NoteEvent, ...],
    tuning: tuple[int, ...] = GUITAR_STANDARD,
    *,
    max_fret: int = 20,
) -> list[tuple[NoteEvent, int, int]]:
    """Assign ``(event, string_index, fret)`` triples via a playability DP.

    Cost per note-on-string = fret + 0.5 * |fret - previous_fret_on_any_string|
    — favors low positions and minimizes hand movement. Notes with no playable
    string/fret in range are dropped (documented via the caller's provenance,
    not silently mismapped).
    """
    ordered = sorted(events, key=lambda e: (e.onset, e.pitch))
    out: list[tuple[NoteEvent, int, int]] = []
    prev_fret = 0
    used_this_onset: dict[float, set[int]] = {}

    for e in ordered:
        candidates = []
        for s_idx, open_pitch in enumerate(tuning):
            fret = e.pitch - open_pitch
            if 0 <= fret <= max_fret:
                candidates.append((s_idx, fret))
        if not candidates:
            continue
        taken = used_this_onset.get(e.onset, set())
        available = [c for c in candidates if c[0] not in taken] or candidates
        s_idx, fret = min(
            available, key=lambda sf: sf[1] + 0.5 * abs(sf[1] - prev_fret)
        )
        used_this_onset.setdefault(e.onset, set()).add(s_idx)
        prev_fret = fret
        out.append((e, s_idx, fret))
    return out


def render_ascii_tab(
    events: tuple[NoteEvent, ...],
    tuning: tuple[int, ...] = GUITAR_STANDARD,
    *,
    max_fret: int = 20,
    cols_per_line: int = 48,
    ticks_per_second: float = 8.0,
) -> str:
    """Render a plain-text tab. Column width is fixed time (``1/ticks_per_second``)."""
    labels = list(_STRING_LABELS_GUITAR if len(tuning) == 6 else _STRING_LABELS_BASS)
    if len(tuning) not in (4, 6):
        labels = [str(i) for i in range(len(tuning))]
    assigned = assign_tab(events, tuning, max_fret=max_fret)
    if not assigned:
        return "(no playable notes for this tuning)"

    last_col = max(int(round(e.onset * ticks_per_second)) for e, _s, _f in assigned)
    n_cols = last_col + 4
    grid = [["-"] * n_cols for _ in tuning]
    for e, s_idx, fret in assigned:
        col = int(round(e.onset * ticks_per_second))
        text = str(fret)
        for k, ch in enumerate(text):
            if col + k < n_cols:
                grid[s_idx][col + k] = ch

    lines_out = []
    high_to_low = list(range(len(tuning) - 1, -1, -1))  # display high string on top
    for start in range(0, n_cols, cols_per_line):
        chunk_end = min(n_cols, start + cols_per_line)
        for s_idx in high_to_low:
            row = "".join(grid[s_idx][start:chunk_end])
            lines_out.append(f"{labels[s_idx]}|{row}|")
        lines_out.append("")
    return "\n".join(lines_out).rstrip() + "\n"


def write_tablature(
    stream: NoteStream,
    path: str | Path,
    *,
    tuning: tuple[int, ...] = GUITAR_STANDARD,
    max_fret: int = 20,
) -> Path:
    """Write an ASCII tab file for a (guitar/bass) NoteStream. Returns the written path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = render_ascii_tab(stream.events, tuning, max_fret=max_fret)
    dropped = len(stream.events) - len(assign_tab(stream.events, tuning, max_fret=max_fret))
    header = f"# Neiro ASCII tablature — {stream.source or 'transcription'}\n"
    if dropped:
        header += f"# {dropped} note(s) out of range for this tuning/fret span were omitted.\n"
    path.write_text(header + "\n" + text, encoding="utf-8")
    return path
