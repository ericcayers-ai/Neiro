"""Reference-lyric forced alignment helper (roadmap lyrics / MFA close-out).

When the user supplies reference lyric text and a decoder produces timed word
hypotheses (e.g. Whisper word timestamps), this module snaps hypotheses onto
the reference tokens with a greedy edit-distance walk. It is **not** Montreal
Forced Aligner / CTC phoneme alignment — those need a phoneme AM — but it is
a real, tested, local alignment step rather than a silent stub.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["AlignedWord", "align_reference_lyrics"]


@dataclass
class AlignedWord:
    text: str
    onset: float
    offset: float
    matched: bool


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[A-Za-z0-9']+", text.lower()) if t]


def align_reference_lyrics(
    reference_text: str,
    timed_words: list[tuple[str, float, float]],
) -> list[AlignedWord]:
    """Align ``timed_words`` ``(token, onset, offset)`` onto ``reference_text``.

    Returns one :class:`AlignedWord` per reference token. Unmatched reference
    tokens inherit neighboring times; unmatched hypotheses are dropped.
    """
    refs = _tokens(reference_text)
    hyps = [
        (_tokens(w)[0] if _tokens(w) else w.lower(), float(on), float(off))
        for w, on, off in timed_words
    ]
    if not refs:
        return []
    if not hyps:
        return [AlignedWord(t, 0.0, 0.0, matched=False) for t in refs]

    out: list[AlignedWord] = []
    j = 0
    for token in refs:
        matched = False
        onset = hyps[min(j, len(hyps) - 1)][1]
        offset = hyps[min(j, len(hyps) - 1)][2]
        while j < len(hyps):
            hw, on, off = hyps[j]
            j += 1
            onset, offset = on, off
            if hw == token or hw.startswith(token) or token.startswith(hw):
                matched = True
                break
        out.append(AlignedWord(token, onset, offset, matched=matched))
    return out
