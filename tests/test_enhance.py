import numpy as np

from neiro.dsp.enhance import declip, peak_normalize, remove_hum, spectral_gate

SR = 44100


def _sine(freq, seconds=2.0, amp=1.0):
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _band_power(x, freq, half=5.0):
    spec = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    m = (freqs >= freq - half) & (freqs <= freq + half)
    return float((spec[m] ** 2).sum())


def test_declip_reduces_error():
    clean = _sine(220.0, amp=1.0)
    clipped = np.clip(clean, -0.6, 0.6)
    restored = declip(clipped[np.newaxis, :], threshold=0.595)[0]
    err_clipped = np.mean((clipped - clean) ** 2)
    err_restored = np.mean((restored - clean) ** 2)
    assert err_restored < err_clipped * 0.5  # at least halves the damage


def test_declip_leaves_clean_audio_alone():
    clean = _sine(220.0, amp=0.5)
    out = declip(clean[np.newaxis, :], threshold=0.985)[0]
    assert np.allclose(out, clean, atol=1e-6)


def test_remove_hum():
    tone = _sine(1000.0, amp=0.5)
    hum = _sine(60.0, amp=0.2) + _sine(120.0, amp=0.1)
    noisy = (tone + hum)[np.newaxis, :]
    cleaned = remove_hum(noisy, SR, fundamental=60.0)[0]
    # Hum bands drop hard; the tone survives.
    assert _band_power(cleaned, 60.0) < _band_power(noisy[0], 60.0) * 0.01
    assert _band_power(cleaned, 120.0) < _band_power(noisy[0], 120.0) * 0.01
    assert _band_power(cleaned, 1000.0) > _band_power(noisy[0], 1000.0) * 0.7


def test_spectral_gate_improves_snr():
    # Spectral gating assumes the signal has pauses (a steady tone is
    # indistinguishable from the floor for a percentile estimator), so the
    # fixture is tone bursts over constant noise.
    rng = np.random.default_rng(7)
    n = 4 * SR
    tone = np.zeros(n, dtype=np.float32)
    t = np.arange(SR) / SR
    burst = (0.4 * np.sin(2 * np.pi * 1000.0 * t)).astype(np.float32)
    tone[0:SR] = burst
    tone[2 * SR : 3 * SR] = burst
    noise = rng.normal(0, 0.02, n).astype(np.float32)
    noisy = (tone + noise)[np.newaxis, :]
    cleaned = spectral_gate(noisy, SR)[0]

    def seg_power(x, a, b):
        return float(np.mean(x[a:b] ** 2))

    # Noise in the silent gap drops by at least 8 dB...
    gap = (int(1.2 * SR), int(1.8 * SR))
    drop_db = 10 * np.log10(seg_power(noisy[0], *gap) / (seg_power(cleaned, *gap) + 1e-15))
    assert drop_db > 8.0
    # ...while the tone bursts survive within 3 dB.
    kept_db = 10 * np.log10(
        seg_power(noisy[0], int(0.2 * SR), int(0.8 * SR))
        / (seg_power(cleaned, int(0.2 * SR), int(0.8 * SR)) + 1e-15)
    )
    assert abs(kept_db) < 3.0


def test_peak_normalize():
    x = _sine(440.0, amp=0.1)[np.newaxis, :]
    out = peak_normalize(x, target_dbfs=-1.0)
    assert abs(20 * np.log10(np.max(np.abs(out))) - (-1.0)) < 0.1
    silence = np.zeros((1, 1000), dtype=np.float32)
    assert np.array_equal(peak_normalize(silence), silence)


def test_analysis_detects_hum_and_echo():
    from neiro.analysis import analyze
    from neiro.engine.artifacts import AudioTensor

    # Hum case.
    tone = _sine(1000.0, amp=0.3)
    hum = _sine(60.0, amp=0.15)
    report = analyze(AudioTensor((tone + hum)[np.newaxis, :], SR))
    assert report.vocal_conditions.get("hum_hz") == 60.0

    # Echo case: aperiodic noise bursts plus a 375 ms delayed copy. The burst
    # spacings (1.1 s, 0.85 s) differ so event periodicity can't masquerade as
    # the echo.
    rng = np.random.default_rng(3)
    env = np.zeros(int(3.5 * SR), dtype=np.float32)
    for start in (0.2, 1.3, 2.15):
        i = int(start * SR)
        env[i : i + int(0.15 * SR)] = 1.0
    burst = env * rng.normal(0, 0.3, env.shape).astype(np.float32)
    delay = int(0.375 * SR)
    echoed = burst.copy()
    echoed[delay:] += 0.7 * burst[:-delay]
    report2 = analyze(AudioTensor(echoed[np.newaxis, :], SR))
    got = report2.vocal_conditions.get("echo_delay_s")
    assert got is not None and abs(got - 0.375) < 0.03
