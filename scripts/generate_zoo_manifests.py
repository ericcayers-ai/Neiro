#!/usr/bin/env python3
"""Generate roadmap §5.1/§6.1 model-zoo manifests wired through audio-separator.

Idempotent: overwrites known zoo files; leaves unrelated manifests alone.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "neiro" / "manifests"

SEP = "neiro.adapters.audio_separator_adapter:AudioSeparatorModel"
ENH = "neiro.adapters.audio_separator_adapter:AudioSeparatorEnhancer"

VI_STEMS = ["vocals", "instrumental"]
VI_LABELS = {"vocals": "Vocals", "instrumental": "Instrumental"}


def sep(
    mid: str,
    display: str,
    filename: str,
    *,
    stems: list[str] | None = None,
    labels: dict[str, str] | None = None,
    quality: str = "reference",
    author: str = "UVR",
    note: str = "credit UVR; verify commercial terms",
    purpose: str | None = None,
    sdr: dict | None = None,
) -> dict:
    stems = stems or VI_STEMS
    labels = labels or VI_LABELS
    prov: dict = {"author": author}
    if purpose:
        prov["purpose"] = purpose
    if sdr:
        prov["leaderboard_sdr"] = sdr
    return {
        "manifest_version": 2,
        "id": mid,
        "task": "separate",
        "stems": stems,
        "display_name": display,
        "adapter": SEP,
        "requires": ["audio_separator"],
        "params": {
            "model_filename": filename,
            "stems": stems,
            "stem_labels": labels,
            "quality_class": quality,
            "license_spdx": "MIT",
            "license_note": note,
        },
        "weights": [{"kind": "managed", "cache_param": "model_file_dir"}],
        "quality_class": quality,
        "license": {
            "spdx": "MIT",
            "note": note,
            "source": "https://github.com/nomadkaraoke/python-audio-separator",
        },
        "provenance": prov,
    }


def enh(
    mid: str,
    display: str,
    filename: str,
    *,
    target: str,
    labels: dict[str, str],
    fixes: str,
    author: str = "UVR",
    quality: str = "reference",
) -> dict:
    return {
        "manifest_version": 2,
        "id": mid,
        "task": "enhance",
        "display_name": display,
        "adapter": ENH,
        "requires": ["audio_separator"],
        "params": {
            "model_filename": filename,
            "target_stem": target,
            "stem_labels": labels,
            "quality_class": quality,
            "license_spdx": "MIT",
            "license_note": "credit UVR/aufr33; verify commercial terms",
        },
        "weights": [{"kind": "managed", "cache_param": "model_file_dir"}],
        "quality_class": quality,
        "license": {
            "spdx": "MIT",
            "note": "credit UVR; verify commercial terms",
            "source": "https://github.com/nomadkaraoke/python-audio-separator",
        },
        "provenance": {"author": author, "fixes": fixes},
    }


MANIFESTS: dict[str, dict] = {
    # --- §5.1 flagship / variants ---
    "sep-bs-roformer-sw.json": sep(
        "bs-roformer-sw",
        "BS-RoFormer SW (jarredou)",
        "BS-Roformer-SW.ckpt",
        author="jarredou / UVR",
        purpose="flagship SW multi-band vocals/instrumental",
    ),
    "sep-bs-roformer-1296.json": sep(
        "bs-roformer-1296",
        "BS-RoFormer (ep 368, SDR 12.96)",
        "model_bs_roformer_ep_368_sdr_12.9628.ckpt",
        author="UVR / viperx",
        sdr={"vocals": 11.7, "instrumental": 16.4},
    ),
    "sep-mel-roformer-kim.json": sep(
        "mel-roformer-kim",
        "Mel-Band RoFormer (Kimberley Jensen)",
        "vocals_mel_band_roformer.ckpt",
        author="Kimberley Jensen",
        purpose="Kim Mel-RoFormer vocals",
    ),
    "sep-mel-roformer-kim-ft.json": sep(
        "mel-roformer-kim-ft",
        "Mel-Band RoFormer Kim FT3 (unwa)",
        "mel_band_roformer_kim_ft3_unwa.ckpt",
        author="unwa / Kimberley Jensen",
    ),
    "sep-mdx23c-8kfft.json": sep(
        "mdx23c-8kfft",
        "MDX23C 8KFFT Inst/Voc HQ",
        "MDX23C-8KFFT-InstVoc_HQ.ckpt",
        author="ZFTurbo / UVR",
        sdr={"vocals": 10.6, "instrumental": 15.8},
    ),
    # --- Karaoke / lead-back ---
    "sep-mdx-b-karaoke.json": sep(
        "mdx-b-karaoke",
        "MDX-B Karaoke (UVR_MDXNET_KARA_2)",
        "UVR_MDXNET_KARA_2.onnx",
        author="UVR",
        purpose="MDX-B karaoke lead vs backing",
        quality="standard",
    ),
    "sep-vr-karaoke.json": sep(
        "vr-karaoke",
        "VR Arch Karaoke (5_HP)",
        "5_HP-Karaoke-UVR.pth",
        author="UVR",
        purpose="VR-arch karaoke diversity member",
        quality="standard",
    ),
    # --- Multi-singer (Medley Vox class via chorus male/female) ---
    "sep-medley-vox.json": sep(
        "medley-vox",
        "Chorus Male/Female (Medley Vox class)",
        "model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt",
        stems=["singer1", "singer2"],
        labels={"singer1": "male", "singer2": "female"},
        author="Sucial",
        purpose="multi-singer / overlapping vocalists (male vs female)",
    ),
    # --- Legacy / texture diversity ---
    "sep-kim-vocal-2.json": sep(
        "kim-vocal-2",
        "Kim Vocal 2 (MDX)",
        "Kim_Vocal_2.onnx",
        author="Kimberley Jensen",
        quality="standard",
        purpose="ensemble diversity member",
    ),
    "sep-uvr-mdx-inst-hq5.json": sep(
        "uvr-mdx-inst-hq5",
        "UVR MDX-NET Inst HQ 5",
        "UVR-MDX-NET-Inst_HQ_5.onnx",
        author="UVR",
        quality="standard",
    ),
    "sep-hdemucs-mmi.json": sep(
        "hdemucs-mmi",
        "Demucs3 MMI (hdemucs_mmi)",
        "hdemucs_mmi.yaml",
        stems=["drums", "bass", "other", "vocals"],
        labels={
            "drums": "Drums",
            "bass": "Bass",
            "other": "Other",
            "vocals": "Vocals",
        },
        author="facebookresearch",
        quality="standard",
        purpose="Demucs3 MMI diversity / draft-lane alternative",
        note="Demucs MIT (facebookresearch)",
    ),
    # --- Instrument family isolators (kuielab + winds) ---
    "sep-kuielab-bass.json": sep(
        "kuielab-bass",
        "Kuielab MDX Bass",
        "kuielab_a_bass.onnx",
        stems=["bass", "instrumental"],
        labels={"bass": "Bass", "instrumental": "Instrumental"},
        author="kuielab",
        quality="standard",
        purpose="bass isolation node",
    ),
    "sep-kuielab-drums.json": sep(
        "kuielab-drums",
        "Kuielab MDX Drums",
        "kuielab_a_drums.onnx",
        stems=["drums", "instrumental"],
        labels={"drums": "Drums", "instrumental": "Instrumental"},
        author="kuielab",
        quality="standard",
        purpose="drums isolation node",
    ),
    "sep-kuielab-vocals.json": sep(
        "kuielab-vocals",
        "Kuielab MDX Vocals",
        "kuielab_a_vocals.onnx",
        stems=["vocals", "instrumental"],
        labels={"vocals": "Vocals", "instrumental": "Instrumental"},
        author="kuielab",
        quality="standard",
        purpose="vocals isolation node",
    ),
    "sep-kuielab-other.json": sep(
        "kuielab-other",
        "Kuielab MDX Other",
        "kuielab_a_other.onnx",
        stems=["other", "instrumental"],
        labels={"other": "Other", "instrumental": "Instrumental"},
        author="kuielab",
        quality="standard",
        purpose="other / residual-complement isolation",
    ),
    "sep-wind-inst.json": sep(
        "wind-inst",
        "VR Arch Woodwinds",
        "17_HP-Wind_Inst-UVR.pth",
        stems=["woodwinds", "no_woodwinds"],
        labels={"woodwinds": "woodwinds", "no_woodwinds": "no woodwinds"},
        author="UVR",
        quality="standard",
        purpose="strings/winds family isolation",
    ),
    # --- Utility separation ---
    "sep-crowd.json": sep(
        "crowd-mdx",
        "UVR MDX Crowd HQ",
        "UVR-MDX-NET_Crowd_HQ_1.onnx",
        stems=["no_crowd", "crowd"],
        labels={"no_crowd": "no crowd", "crowd": "crowd"},
        author="aufr33",
        purpose="crowd removal",
    ),
    "sep-crowd-roformer.json": sep(
        "crowd-roformer",
        "Mel-RoFormer Crowd (aufr33/viperx)",
        "mel_band_roformer_crowd_aufr33_viperx_sdr_8.7144.ckpt",
        stems=["no_crowd", "crowd"],
        labels={"no_crowd": "nocrowd", "crowd": "crowd"},
        author="aufr33 / viperx",
        purpose="crowd removal (RoFormer)",
    ),
    # --- Enhancement utility (roadmap §5.1 utility + §6.1) ---
    "enh-aspiration.json": enh(
        "aspiration-roformer",
        "Aspiration / de-breath (Mel-RoFormer)",
        "aspiration_mel_band_roformer_sdr_18.9845.ckpt",
        target="other",
        labels={"aspiration": "aspiration", "other": "other"},
        fixes="de-breath / aspiration removal",
        author="Sucial",
    ),
    "enh-vr-denoise.json": enh(
        "vr-denoise",
        "VR Arch DeNoise",
        "UVR-DeNoise.pth",
        target="dry",
        labels={"dry": "dry", "noise": "noise"},
        fixes="broadband noise (VR-arch)",
        author="UVR",
        quality="standard",
    ),
    "enh-vr-dereverb.json": enh(
        "vr-dereverb",
        "VR Arch De-Reverb (aufr33)",
        "UVR-De-Reverb-aufr33-jarredou.pth",
        target="dry",
        labels={"dry": "dry", "reverb": "reverb"},
        fixes="dereverb (VR-arch)",
        author="aufr33-jarredou",
        quality="standard",
    ),
    "enh-vr-deecho.json": enh(
        "vr-deecho",
        "VR Arch DeEcho + DeReverb",
        "UVR-DeEcho-DeReverb.pth",
        target="dry",
        labels={"dry": "dry", "echo": "echo"},
        fixes="de-echo / delay + light dereverb",
        author="UVR",
        quality="standard",
    ),
    "enh-bleed-suppressor.json": enh(
        "bleed-suppressor",
        "Mel-RoFormer Bleed Suppressor",
        "mel_band_roformer_bleed_suppressor_v1.ckpt",
        target="dry",
        labels={"dry": "dry", "bleed": "bleed"},
        fixes="post-separation bleed suppression",
        author="unwa-97chris",
    ),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in MANIFESTS.items():
        path = OUT / name
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({data['id']})")
    print(f"total generated: {len(MANIFESTS)}")


if __name__ == "__main__":
    main()
