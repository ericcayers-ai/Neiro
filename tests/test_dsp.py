import numpy as np

from neiro.dsp import center_extract, harmonic_percussive, istft, residual, stft


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
