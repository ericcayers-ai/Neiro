"""Pure-DSP signal processing: separation, restoration, pitch, ensembles, editing."""

from neiro.dsp.bleed import bleed_estimate_db, suppress_bleed, suppress_bleed_multi
from neiro.dsp.enhance import declick, declip, peak_normalize, remove_hum, spectral_gate, vocal_repair
from neiro.dsp.ensemble import fuse_stems, tta_separate
from neiro.dsp.kit import drum_kit_split
from neiro.dsp.pitch import spectral_flux_onsets, transcribe_mono, yin_track
from neiro.dsp.separation import (
    band_extract,
    center_extract,
    harmonic_percussive,
    istft,
    residual,
    stft,
)
from neiro.dsp.stereo import from_mid_side, process_mid_side, restore_width, to_mid_side
from neiro.dsp.visual import spectrogram_image, waveform_peaks

__all__ = [
    "center_extract",
    "harmonic_percussive",
    "residual",
    "band_extract",
    "stft",
    "istft",
    "declip",
    "declick",
    "vocal_repair",
    "remove_hum",
    "spectral_gate",
    "peak_normalize",
    "fuse_stems",
    "tta_separate",
    "suppress_bleed",
    "suppress_bleed_multi",
    "bleed_estimate_db",
    "to_mid_side",
    "from_mid_side",
    "process_mid_side",
    "restore_width",
    "drum_kit_split",
    "transcribe_mono",
    "yin_track",
    "spectral_flux_onsets",
    "waveform_peaks",
    "spectrogram_image",
]
