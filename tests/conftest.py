import numpy as np
import pytest

from neiro.engine.artifacts import AudioTensor


def _sine(freq: float, seconds: float, sr: int, phase: float = 0.0) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return np.sin(2 * np.pi * freq * t + phase).astype(np.float32)


@pytest.fixture
def sr() -> int:
    return 44100


@pytest.fixture
def stereo_mix(sr):
    """A stereo mix: a centred 'vocal' sine + a hard-left 'guitar' + noise.

    The vocal is identical in L/R (centre-panned); the guitar sits only in L.
    Amplitudes kept well below clipping.
    """
    seconds = 2.0
    vocal = 0.4 * _sine(220.0, seconds, sr)          # centred
    guitar = 0.3 * _sine(660.0, seconds, sr)         # panned left
    perc = 0.15 * _sine(3000.0, seconds, sr)         # centred high (transient-ish)
    left = vocal + guitar + perc
    right = vocal + perc
    return AudioTensor(np.stack([left, right]).astype(np.float32), sr)


@pytest.fixture
def mono_tone(sr):
    seconds = 1.5
    x = 0.5 * _sine(440.0, seconds, sr)
    return AudioTensor(x[np.newaxis, :], sr)
