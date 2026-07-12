# Adding a model

Neiro's core never imports a model repository. Models arrive as **manifests** that
point at an **adapter** implementing one of four protocols. Adding a model is a
manifest plus a small adapter class — no changes to the engine.

## 1. Write the adapter

Pick the protocol for your task from `neiro.nodes.base`:

| Task | Protocol | Returns |
|------|----------|---------|
| `separate` | `Separator` | `dict[str, AudioTensor]` (stem name → audio) |
| `transcribe` | `Transcriber` | `NoteStream` |
| `enhance` | `Enhancer` | `AudioTensor` |
| `analyze` | `Analyzer` | `AnalysisReport` |

Each adapter carries a `ModelProfile` (used by the VRAM manager and planner) and
imports heavy dependencies **lazily inside `load()`** so the core stays importable
without them.

```python
# my_pkg/adapters.py
from neiro.engine.artifacts import AudioTensor
from neiro.nodes.base import ModelProfile


class MySeparator:
    def __init__(self, model_id="my-sep", **params):
        self.profile = ModelProfile(
            model_id=model_id,
            task="separate",
            stems=("vocals", "instrumental"),
            fp32_gb=6.0, fp16_gb=3.2, supports_fp16=True,
            sample_rate=44100,
            quality_class="reference",   # draft | standard | reference
            license_spdx="MIT",
        )
        self._model = None

    def load(self, device, precision):
        import torch                      # heavy import: lazy, inside load()
        from my_pkg import load_weights
        self._model = load_weights(precision).to(device)

    def separate(self, audio: AudioTensor) -> dict[str, AudioTensor]:
        # audio.samples is (channels, frames) float32 at profile.sample_rate.
        vocals, instrumental = self._model(audio.samples)
        return {
            "vocals": AudioTensor(vocals, audio.sample_rate).with_provenance(self.profile.model_id),
            "instrumental": AudioTensor(instrumental, audio.sample_rate).with_provenance(self.profile.model_id),
        }

    def unload(self):
        self._model = None
```

The adapter is duck-typed against a `@runtime_checkable` `Protocol`, so it doesn't
need to subclass anything — it just needs the right attributes and methods.

## 2. Write the manifest

Drop a JSON file in `src/neiro/manifests/` (or any directory you scan):

```json
{
  "manifest_version": 2,
  "id": "my-sep",
  "task": "separate",
  "stems": ["vocals", "instrumental"],
  "display_name": "My Separator",
  "adapter": "my_pkg.adapters:MySeparator",
  "requires": ["torch"],
  "params": { "some_option": true },
  "audio": { "sample_rate": 44100, "channels": 2 },
  "quality_class": "reference",
  "vram": { "fp32_gb": 6.0, "fp16_gb": 3.2, "supports_fp16": true },
  "license": { "spdx": "MIT", "source": "https://github.com/…" },
  "provenance": { "author": "you", "trained_on": ["musdb18hq"] }
}
```

Key fields:

- **`adapter`** — `import.path:ClassName`. The registry imports and instantiates it.
- **`requires`** — importable module names the backend needs. `available()` probes
  these with `find_spec` (no import side effects); if any is missing the model is
  listed but marked unavailable, and the planner routes around it.
- **`params`** — passed to the adapter constructor as keyword arguments.
- **`license.spdx`** — **get this right.** It is shown in `neiro models` and carried
  into export metadata. Non-commercial and research-only weights must say so.
- **`quality_class`** — how the planner ranks it against the requested tier.

## 3. Verify

```bash
neiro models        # your model should appear; "available" reflects requires
```

```python
from neiro.engine.registry import default_registry
reg = default_registry()
entry = reg.get("my-sep")
assert entry.available()
sep = entry.instantiate()
```

## 4. Ensembles are manifests too

An ensemble references other adapters and fuses their outputs on complex
spectrograms. No new code — just a manifest using `EnsembleSeparator`:

```json
{
  "id": "my-ensemble", "task": "separate",
  "stems": ["vocals", "instrumental"],
  "adapter": "neiro.adapters.ensemble_separator:EnsembleSeparator",
  "params": {
    "mode": "mean", "tta": true,
    "members": [
      { "adapter": "my_pkg.adapters:MySeparator", "weight": 1.0 },
      { "adapter": "neiro.adapters.dsp_separators:CenterSeparator", "weight": 0.5 }
    ]
  },
  "quality_class": "reference",
  "license": { "spdx": "MIT" }
}
```

Fusion modes: `mean`, `median`, `max` (favours recall of the target stem), `min`
(favours purity). See `neiro.dsp.ensemble.fuse_stems`.

## 5. Add a test

Follow the ground-truth pattern: synthesize an input with known properties and
assert on measurable output. For a separator, a common check is the **null test**
— `source − Σ(stems)` should be near-silent if the model accounts for the mix.
See `tests/test_pipeline.py` and `tests/test_ensemble_and_plans.py`.
