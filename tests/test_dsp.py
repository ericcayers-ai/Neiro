import numpy as np

from neiro.dsp import center_extract, harmonic_percussive, istft, residual, stft
from neiro.dsp.chunking import separate_chunked
from neiro.engine.artifacts import AudioTensor


def test_separate_chunked_matches_whole_file(mono_tone):
    def identity(chunk: AudioTensor) -> dict[str, AudioTensor]:
        return {"dry": chunk}

    out = separate_chunked(identity, mono_tone, chunk_seconds=0.25, overlap=0.25, chunk_scale=0.5)
    assert "dry" in out
    assert out["dry"].frames == mono_tone.frames
    err = np.sqrt(np.mean((out["dry"].samples - mono_tone.samples) ** 2))
    assert err < 2e-4


def test_chunk_starts_avoids_tiny_draft_tail():
    """Draft overlap 10% on 30s / 8s chunks must not leave a ~1.2s stub."""
    from neiro.dsp.chunking import chunk_starts

    sr = 44100
    total = 30 * sr
    chunk_frames = 8 * sr
    hop = int(chunk_frames * 0.9)  # draft tier
    starts = chunk_starts(total, chunk_frames, hop)
    lengths = [min(total, s + chunk_frames) - s for s in starts]
    assert min(lengths) == chunk_frames
    assert starts[-1] + chunk_frames == total


def test_separate_chunked_aligns_short_stem_output(mono_tone):
    """Separator returning a shorter stem than the chunk must still fuse."""

    def short_stem(chunk: AudioTensor) -> dict[str, AudioTensor]:
        n = max(1, chunk.frames - 17)
        return {"dry": AudioTensor(chunk.samples[:, :n].copy(), chunk.sample_rate)}

    out = separate_chunked(short_stem, mono_tone, chunk_seconds=0.25, overlap=0.1, chunk_scale=0.5)
    assert out["dry"].frames == mono_tone.frames


def test_stft_istft_roundtrip_interior(mono_tone):
    x = mono_tone.samples[0]
    y = istft(stft(x, 2048, 512), 2048, 512, length=len(x))
    # Interior reconstruction (away from edges) is near-exact for COLA windows.
    a, b = 4096, len(x) - 4096
    err = np.sqrt(np.mean((x[a:b] - y[a:b]) ** 2))
    assert err < 1e-3


def test_center_extract_reconstructs(stereo_mix):
    centre, sides = center_extract(stereo_mix.samples, stereo_mix.sample_rate)
    assert centre.shape == stereo_mix.samples.shape
    resid = residual(stereo_mix.samples, [centre, sides])
    # centre + sides must reconstruct the source (null test) in the interior.
    a, b = 4096, resid.shape[1] - 4096
    rms = np.sqrt(np.mean(resid[:, a:b] ** 2))
    assert rms < 1e-3


def test_center_captures_centred_energy(stereo_mix):
    centre, sides = center_extract(stereo_mix.samples, stereo_mix.sample_rate)

    # The panned-left 660 Hz tone should end up more in 'sides' than 'centre'.
    def band_energy(sig, sr, f):
        S = np.abs(stft(sig.mean(axis=0), 4096, 1024))
        freqs = np.fft.rfftfreq(4096, 1 / sr)
        idx = int(np.argmin(np.abs(freqs - f)))
        return float(S[idx].sum())

    guitar_in_centre = band_energy(centre, stereo_mix.sample_rate, 660.0)
    guitar_in_sides = band_energy(sides, stereo_mix.sample_rate, 660.0)
    assert guitar_in_sides > guitar_in_centre


def test_hpss_shapes_and_reconstruction(stereo_mix):
    harm, perc = harmonic_percussive(stereo_mix.samples, stereo_mix.sample_rate, kernel=17)
    assert harm.shape == stereo_mix.samples.shape
    assert perc.shape == stereo_mix.samples.shape
    # Soft masks sum to 1, so harmonic + percussive reconstructs the source interior.
    resid = residual(stereo_mix.samples, [harm, perc])
    a, b = 4096, resid.shape[1] - 4096
    assert np.sqrt(np.mean(resid[:, a:b] ** 2)) < 5e-3
