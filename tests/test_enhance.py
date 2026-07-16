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
    conf = report2.vocal_conditions.get("echo_confidence")
    assert conf is not None and conf > 0.35


def test_stem_preview_echo_prefers_vocal_stem():
    """Draft preview split runs; stem echo is surfaced with preview-split provenance."""
    from neiro.analysis import analyze
    from neiro.analysis.report import _draft_preview_stems, _echo_detect, _stem_echo_conditions
    from neiro.engine.artifacts import AudioTensor

    # Same aperiodic burst+echo fixture as the mix-level test (proven stable).
    rng = np.random.default_rng(3)
    env = np.zeros(int(3.5 * SR), dtype=np.float32)
    for start in (0.2, 1.3, 2.15):
        i = int(start * SR)
        env[i : i + int(0.15 * SR)] = 1.0
    burst = env * rng.normal(0, 0.3, env.shape).astype(np.float32)
    delay = int(0.375 * SR)
    echoed = burst.copy()
    echoed[delay:] += 0.7 * burst[:-delay]
    # Stereo-identical: centre_extract keeps the vocal proxy; HPSS still runs.
    stereo = np.stack([echoed, echoed]).astype(np.float32)

    stems = _draft_preview_stems(stereo, SR)
    assert stems is not None and "vocals" in stems and "drums" in stems
    vocal_hit = _echo_detect(stems["vocals"], SR)
    assert vocal_hit is not None
    v_delay, v_conf = vocal_hit
    assert abs(v_delay - 0.375) < 0.03
    assert v_conf > 0.35

    cond = _stem_echo_conditions(stereo, SR)
    assert cond.get("echo_based_on_preview_split") is True
    assert isinstance(cond.get("stem_echo"), dict)
    assert "vocals" in cond["stem_echo"]
    assert abs(float(cond["stem_echo"]["vocals"]["delay_s"]) - 0.375) < 0.03
    assert cond["echo_source"].startswith("preview_split_")
    assert abs(float(cond["echo_delay_s"]) - 0.375) < 0.03

    report = analyze(AudioTensor(stereo, SR))
    assert report.vocal_conditions.get("echo_based_on_preview_split") is True
    assert any("preview split" in n for n in report.notes)



def test_analysis_corrections_apply_and_reset():
    from neiro.analysis import AnalysisCorrections, analyze
    from neiro.engine.artifacts import AudioTensor

    tone = _sine(440.0, amp=0.2, seconds=1.5)
    report = analyze(AudioTensor(tone[np.newaxis, :], SR))
    corr = AnalysisCorrections()
    corr.set("estimated_key", "D minor", reason="user")
    corr.set("estimated_bpm", 96.0, reason="user")
    corr.set(
        "instruments",
        ({"instrument": "piano", "confidence": 1.0, "status": "asserted"},),
        reason="user",
    )
    applied = corr.apply(report)
    assert applied.estimated_key == "D minor"
    assert applied.estimated_bpm == 96.0
    assert applied.instruments[0]["instrument"] == "piano"
    assert any(n.startswith("corrected:") for n in applied.notes)
    # Original report untouched (frozen overlay).
    orig_key, orig_bpm = report.estimated_key, report.estimated_bpm
    assert report is not applied
    assert report.estimated_key == orig_key
    assert report.estimated_bpm == orig_bpm

    corr.clear("estimated_key")
    corr.clear("estimated_bpm")
    corr.clear("instruments")
    assert corr.is_empty()
    reset = corr.apply(report)
    assert reset is report
    assert reset.estimated_key == report.estimated_key
    assert reset.estimated_bpm == report.estimated_bpm


def test_planner_prefers_stem_conditioned_echo_notes(tmp_path, monkeypatch):
    from neiro.engine import planner as planner_mod
    from neiro.engine.vram import VRAMManager
    from neiro.engine.registry import default_registry

    class _FakeReport:
        clipping_ratio = 0.0
        bandwidth_hz = 20000.0
        vocal_conditions = {
            "echo_delay_s": 0.28,
            "echo_confidence": 0.62,
            "echo_based_on_preview_split": True,
            "echo_source": "preview_split_vocals",
            "stem_echo": {
                "vocals": {"delay_s": 0.28, "confidence": 0.62},
                "drums": {"delay_s": 0.31, "confidence": 0.4},
            },
        }

    monkeypatch.setattr(
        planner_mod,
        "_quick_analysis",
        lambda _path, corrections=None, **_kw: _FakeReport(),
    )
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"RIFF")  # path only; analysis is stubbed
    plan = planner_mod.plan_enhancement(
        wav, default_registry(), VRAMManager(), chain=None, auto_download=False
    )
    joined = " | ".join(plan.notes)
    assert "stem-conditioned echo/delay on preview split" in joined
    assert "vocals ~280 ms" in joined
    assert "drums ~310 ms" in joined


def test_planner_consumes_analysis_corrections_for_detect_all(tmp_path, monkeypatch):
    """User instrument corrections must drive detect-all cascade order."""
    from neiro.analysis import AnalysisCorrections
    from neiro.engine import planner as planner_mod
    from neiro.engine.artifacts import AnalysisReport
    from neiro.engine.registry import default_registry
    from neiro.engine.vram import VRAMManager

    def _qa(_path, corrections=None, **_kw):
        report = AnalysisReport(
            duration_seconds=1.0,
            sample_rate=44100,
            channels=2,
            is_effectively_mono=False,
            integrated_lufs=-14.0,
            peak_dbfs=-1.0,
            bandwidth_hz=20000.0,
            instruments=(
                {"instrument": "vocals", "confidence": 0.9, "status": "asserted"},
                {"instrument": "drums", "confidence": 0.8, "status": "asserted"},
            ),
        )
        if corrections:
            return AnalysisCorrections.from_dict(corrections).apply(report)
        return report

    monkeypatch.setattr(planner_mod, "_quick_analysis", _qa)
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"RIFF")
    corr = {
        "overrides": {
            "instruments": [
                {"instrument": "drums", "confidence": 1.0, "status": "asserted"},
                {"instrument": "bass", "confidence": 1.0, "status": "asserted"},
            ]
        },
        "reasons": {"instruments": "user"},
    }
    plan = planner_mod.plan_separation(
        wav,
        "detect-all",
        default_registry(),
        VRAMManager(),
        auto_download=False,
        corrections=corr,
    )
    joined = " | ".join(plan.notes)
    assert "using Analysis corrections for instrument routing" in joined
    assert "detect-all cascade order (by confidence): drums, bass" in joined

