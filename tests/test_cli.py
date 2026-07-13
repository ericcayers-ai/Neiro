"""End-to-end CLI tests — drive the same entry point users invoke."""

import json

import numpy as np
import soundfile as sf

from neiro.cli import main


def _write(tmp_path, name="in.wav", stereo=True, seconds=1.5, sr=44100):
    t = np.arange(int(seconds * sr)) / sr
    vocal = 0.4 * np.sin(2 * np.pi * 220 * t)
    gtr = 0.3 * np.sin(2 * np.pi * 660 * t)
    left = (vocal + gtr).astype(np.float32)
    right = vocal.astype(np.float32)
    data = np.stack([left, right]).T if stereo else left[:, None]
    path = tmp_path / name
    sf.write(str(path), data, sr, subtype="FLOAT")
    return path


def test_cli_analyze(tmp_path, capsys):
    wav = _write(tmp_path)
    assert main(["analyze", str(wav)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["channels"] == 2
    assert out["sample_rate"] == 44100


def test_cli_models(tmp_path, capsys):
    assert main(["models"]) == 0
    out = capsys.readouterr().out
    assert "dsp-center" in out
    assert "AVAIL" in out and "DOWNL" in out


def test_cli_separate_writes_stems(tmp_path):
    wav = _write(tmp_path)
    out_dir = tmp_path / "stems"
    rc = main(["separate", str(wav), "--preset", "vocals", "--out", str(out_dir), "--quiet"])
    assert rc == 0
    names = {p.name for p in out_dir.iterdir()}
    assert {"vocals.wav", "instrumental.wav", "residual.wav"} <= names


def test_cli_transcribe_writes_midi(tmp_path):
    # A clean mono melody so YIN has something to track.
    sr = 16000
    parts = []
    for f in (261.63, 329.63):
        t = np.arange(int(0.5 * sr)) / sr
        x = 0.5 * np.sin(2 * np.pi * f * t)
        x[:160] *= np.linspace(0, 1, 160)
        x[-160:] *= np.linspace(1, 0, 160)
        parts.append(x.astype(np.float32))
        parts.append(np.zeros(int(0.1 * sr), dtype=np.float32))
    wav = tmp_path / "mel.wav"
    sf.write(str(wav), np.concatenate(parts), sr, subtype="FLOAT")

    midi = tmp_path / "out.mid"
    rc = main(["transcribe", str(wav), "--mode", "direct", "--out", str(midi), "--quiet"])
    assert rc == 0
    assert midi.exists() and midi.read_bytes()[:4] == b"MThd"


def test_cli_enhance_explicit_chain(tmp_path):
    wav = _write(tmp_path, name="tone.wav", stereo=False)
    out = tmp_path / "fixed.wav"
    rc = main(["enhance", str(wav), "--chain", "normalize", "--out", str(out), "--quiet"])
    assert rc == 0
    assert out.exists()


def test_cli_missing_file_is_clean_error(tmp_path, capsys):
    rc = main(["analyze", str(tmp_path / "nope.wav")])
    assert rc == 1
    assert "error:" in capsys.readouterr().err


def test_cli_unknown_preset_rejected(tmp_path, capsys):
    # argparse rejects invalid choices with exit code 2.
    wav = _write(tmp_path)
    try:
        main(["separate", str(wav), "--preset", "bogus"])
    except SystemExit as exc:
        assert exc.code == 2
    else:  # pragma: no cover
        raise AssertionError("expected SystemExit from argparse")
