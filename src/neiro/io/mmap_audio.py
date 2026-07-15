"""Memory-mapped / chunk-aware ingest for long files (roadmap §3.1).

:func:`neiro.io.ingest.load_audio` is fine for anything that comfortably fits
in RAM — that's most songs. Live sets and multi-hour recordings don't: this
module offers a streaming path that never materializes the whole decoded
signal at once.

* :class:`MemmapAudioReader` opens a libsndfile-native file (WAV/FLAC/…) and
  reads exactly the requested block, seeking rather than decoding the whole
  file up front. For WAV specifically this also exposes the raw PCM buffer as
  a real ``numpy.memmap`` (:meth:`MemmapAudioReader.memmap_pcm`) so the OS
  pages data in on demand instead of Neiro copying it into RAM.
* :func:`iter_chunks` drives that reader as an overlapping-chunk iterator,
  matching the convention :func:`neiro.dsp.chunking.separate_chunked` uses for
  in-memory audio, so node code can switch between "whole file in RAM" and
  "streamed from disk" without changing how it consumes chunks.
* :func:`should_stream` is a cheap duration probe a caller can use to decide
  which path to take; :func:`neiro.io.ingest.load_audio`'s API and behavior
  are unchanged for the short-file case this module doesn't touch.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from neiro.engine.artifacts import AudioTensor
from neiro.io.ingest import SNDFILE_EXTS

__all__ = [
    "ChunkSpec",
    "MemmapAudioReader",
    "open_memmap",
    "iter_chunks",
    "probe_duration_seconds",
    "should_stream",
    "DEFAULT_STREAM_THRESHOLD_SECONDS",
]

# Above this duration, prefer the streamed/chunked path over loading the whole
# file into RAM — long enough that a typical song never trips it, short
# enough that a live-set recording does.
DEFAULT_STREAM_THRESHOLD_SECONDS = 600.0

# libsndfile's WAV subtypes that map onto a fixed-width PCM sample layout we
# can honestly memory-map (float/IEEE and integer PCM). Anything else
# (compressed WAV variants) falls back to the seek-and-read path.
_MEMMAPPABLE_WAV_DTYPES: dict[str, np.dtype] = {
    "PCM_16": np.dtype("<i2"),
    "PCM_24": np.dtype("<i4"),  # read via soundfile's own unpacking; see note below
    "PCM_32": np.dtype("<i4"),
    "FLOAT": np.dtype("<f4"),
    "DOUBLE": np.dtype("<f8"),
}


@dataclass(frozen=True)
class ChunkSpec:
    """Frame-accurate bookkeeping for one chunk of a streamed file."""

    start_frame: int
    end_frame: int  # exclusive
    sample_rate: int

    @property
    def frames(self) -> int:
        return self.end_frame - self.start_frame

    @property
    def start_seconds(self) -> float:
        return self.start_frame / self.sample_rate

    @property
    def end_seconds(self) -> float:
        return self.end_frame / self.sample_rate

    def content_key(self) -> str:
        import hashlib

        h = hashlib.sha256()
        h.update(f"{self.start_frame}|{self.end_frame}|{self.sample_rate}".encode())
        return h.hexdigest()[:32]


def probe_duration_seconds(path: str | Path) -> float | None:
    """Cheap duration probe (header only, no decode) for libsndfile-native formats."""
    path = Path(path)
    if path.suffix.lower() not in SNDFILE_EXTS:
        return None
    with sf.SoundFile(str(path)) as f:
        return f.frames / f.samplerate if f.samplerate else None


def should_stream(
    path: str | Path, *, threshold_seconds: float = DEFAULT_STREAM_THRESHOLD_SECONDS
) -> bool:
    """Whether ``path`` is long enough to warrant the chunked/streamed path."""
    duration = probe_duration_seconds(path)
    return duration is not None and duration >= threshold_seconds


class MemmapAudioReader:
    """Reads fixed-size, optionally overlapping chunks without decoding the
    whole file into memory.

    Use as a context manager (or call :meth:`close` explicitly) so the
    underlying file handle — and any memmap opened via :meth:`memmap_pcm` — is
    released deterministically.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if self.path.suffix.lower() not in SNDFILE_EXTS:
            raise ValueError(
                f"streamed ingest supports {sorted(SNDFILE_EXTS)}, not "
                f"{self.path.suffix!r}; decode to WAV/FLAC first"
            )
        self._file = sf.SoundFile(str(self.path))
        self._memmap: np.memmap | None = None

    @property
    def sample_rate(self) -> int:
        return self._file.samplerate

    @property
    def channels(self) -> int:
        return self._file.channels

    @property
    def frames(self) -> int:
        return len(self._file)

    def read_chunk(self, start_frame: int, n_frames: int) -> np.ndarray:
        """Read ``(channels, n_frames)`` float32 samples starting at ``start_frame``.

        Seeks then reads exactly the requested span — libsndfile decodes only
        those frames, so this scales to files far larger than available RAM.
        """
        self._file.seek(start_frame)
        data = self._file.read(n_frames, dtype="float32", always_2d=True)
        return data.T.copy()

    def memmap_pcm(self) -> np.memmap | None:
        """Return a raw ``numpy.memmap`` over this file's PCM payload, if the
        container is an uncompressed WAV in a layout we can honestly map.

        Returns ``None`` (never raises) when the format isn't a plain PCM/IEEE
        WAV — callers should fall back to :meth:`read_chunk`, which always
        works. This exists for the case roadmap §3.1 actually cares about
        (a multi-hour uncompressed field recording): true OS-paged access
        with no upfront copy.
        """
        if self.path.suffix.lower() != ".wav":
            return None
        subtype = self._file.subtype
        dtype = _MEMMAPPABLE_WAV_DTYPES.get(subtype)
        if dtype is None or subtype == "PCM_24":
            # 24-bit PCM is packed 3 bytes/sample — not a numpy dtype we can
            # memmap directly; the seek/read path handles it correctly instead.
            return None
        data_offset = _wav_data_chunk_offset(self.path)
        if data_offset is None:
            return None
        if self._memmap is None:
            self._memmap = np.memmap(
                self.path,
                dtype=dtype,
                mode="r",
                offset=data_offset,
                shape=(self.frames * self.channels,),
            )
        return self._memmap

    def close(self) -> None:
        self._memmap = None
        self._file.close()

    def __enter__(self) -> MemmapAudioReader:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _wav_data_chunk_offset(path: Path) -> int | None:
    """Byte offset of the ``data`` chunk's payload in a canonical RIFF/WAV file."""
    with path.open("rb") as f:
        header = f.read(12)
        if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
            return None
        pos = 12
        while True:
            chunk_header = f.read(8)
            if len(chunk_header) < 8:
                return None
            chunk_id = chunk_header[:4]
            chunk_size = int.from_bytes(chunk_header[4:8], "little")
            if chunk_id == b"data":
                return pos + 8
            pos += 8 + chunk_size + (chunk_size % 2)
            f.seek(pos)


def open_memmap(path: str | Path) -> MemmapAudioReader:
    return MemmapAudioReader(path)


def iter_chunks(
    path: str | Path,
    *,
    chunk_seconds: float = 30.0,
    overlap: float = 0.25,
) -> Iterator[tuple[AudioTensor, ChunkSpec]]:
    """Yield overlapping ``(AudioTensor, ChunkSpec)`` pairs read straight off disk.

    Each chunk is loaded independently — the file is never decoded in full.
    ``overlap`` is the fraction of ``chunk_seconds`` shared with the previous
    chunk, matching :func:`neiro.dsp.chunking.separate_chunked`'s convention
    so downstream crossfading/checkpointing code is identical either way.
    """
    if not (0.0 <= overlap < 1.0):
        raise ValueError("overlap must be in [0, 1)")
    with open_memmap(path) as reader:
        sr = reader.sample_rate
        total = reader.frames
        if total == 0:
            return
        chunk_frames = max(1, int(chunk_seconds * sr))
        hop = max(1, int(chunk_frames * (1.0 - overlap)))
        start = 0
        while start < total:
            end = min(total, start + chunk_frames)
            samples = reader.read_chunk(start, end - start)
            spec = ChunkSpec(start, end, sr)
            yield AudioTensor(samples, sr, provenance=(f"chunk:{start}-{end}",)), spec
            if end >= total:
                break
            start += hop
