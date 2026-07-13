# PyInstaller spec for the Neiro core (DSP floor) — a self-contained CLI/UI exe.
#
# This freezes the *model-free* engine: separation (centre/HPSS/ensemble),
# restoration (declip/dehum/denoise/normalize), transcription (YIN), the analysis
# pass, the audio editor, and the local UI — everything that runs with no
# downloads. Neural backends (torch/onnxruntime-based) are intentionally NOT
# frozen here: they are large, platform-specific, and best installed into a real
# environment (the launcher-script bundle does that). The frozen app still shows
# neural models in `neiro models` and, if their packages happen to be importable
# on PATH, can use them — but the exe itself stays lean and reliable.
#
# Build:  pyinstaller packaging/neiro.spec --noconfirm
# Output: dist/neiro/neiro(.exe)  — one folder, launched by the bundle scripts.

from PyInstaller.utils.hooks import collect_data_files

datas = []
# libsndfile shipped inside the soundfile package.
datas += collect_data_files("soundfile")
# Neiro's packaged manifests and the UI page.
datas += collect_data_files("neiro", includes=["manifests/*.json", "ui/*.html", "py.typed"])

hiddenimports = [
    "neiro.adapters.dsp_separators",
    "neiro.adapters.dsp_enhancers",
    "neiro.adapters.dsp_transcriber",
    "neiro.adapters.ensemble_separator",
    "scipy.signal",
    "scipy.ndimage",
    "scipy.interpolate",
]

# Keep the bundle lean: exclude the heavy optional ML stacks even if present in
# the build environment. They are handled by the launcher-script install path.
excludes = [
    "torch", "torchaudio", "torchvision", "onnxruntime", "tensorflow",
    "audio_separator", "audiosr", "basic_pitch", "matplotlib", "IPython",
    "pytest", "PyInstaller",
]

a = Analysis(
    ["neiro_entry.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="neiro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="neiro",
)
