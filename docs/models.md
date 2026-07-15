# Model registry

Every model Neiro can use is a JSON manifest under `src/neiro/manifests/`, scanned
by `neiro.engine.registry` at startup. A manifest is a *reference*, not a bundled
dependency: no weights ship in this repository, and the pure-DSP entries need no
weights at all. Run `neiro models` for the live, machine-specific view (it adds
`AVAIL`/`DOWNL` columns for your environment); this page is the human-readable
tour plus the licensing detail that matters before you rely on a model's output.

See [`docs/adding-models.md`](adding-models.md) for how to add one, and
[`SECURITY.md`](../SECURITY.md) for the model-weight supply-chain note.

## Reading this table

- **Tier** — `draft` (fastest, lowest quality), `standard`, `reference` (slowest,
  highest quality; what Advanced/Reference-tier jobs select). See roadmap §5.2.
- **License** — the manifest's `license.spdx`. This is **not legal advice**; it
  reflects what the manifest author recorded from the upstream source at the time
  of writing. Always check the linked source for material use (especially
  anything commercial). `neiro models` and export sidecar files (`*.meta.json`)
  surface this at runtime so it travels with your output.
- **Requires** — the optional `pip install neiro[...]` extra (or underlying pip
  package) that must be installed for the model to be `available`. Being listed
  without the extra installed is expected — the registry always lists every
  manifest; `available()` reflects your current environment.

## Separation

| Model | Manifest id | Stems | Tier | License | Extra |
|---|---|---|---|---|---|
| Centre extraction (azimuth masking) | `dsp-center` | vocals, instrumental | draft | MIT | *(none — DSP floor)* |
| Centre ensemble + TTA | `dsp-center-ensemble` | vocals, instrumental | standard | MIT | *(none — DSP floor)* |
| Harmonic/percussive (median-filter HPSS) | `dsp-hpss` | harmonic, percussive | draft | MIT | *(none — DSP floor)* |
| BS-RoFormer (viperx 1297) | `bs-roformer-1297` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer (instrumental) | `mel-roformer-inst` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer Karaoke | `mel-roformer-karaoke` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| MDX23C inst/voc | `mdx23c-instvoc` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| MDX23C drumsep | `mdx23c-drumsep` | kick, snare, toms, hh, ride, crash | reference | MIT¹ | `neiro[separation]` |
| HTDemucs v4 fine-tuned | `htdemucs-ft` | vocals, drums, bass, other | standard | MIT | `neiro[separation]` or `neiro[demucs]` |
| HTDemucs 6-stem | `htdemucs-6s` | vocals, drums, bass, guitar, piano, other | standard | MIT | `neiro[separation]` |
| Neural vocals ensemble | `vocals-neural-ensemble` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |

¹ The weights are re-hosted/wrapped by the `audio-separator` package under
permissive terms per its own documentation; several of these architectures have
community fine-tunes with mixed licensing upstream (see roadmap §14 "Model
licensing" risk). Verify before commercial use.

## Restoration / enhancement

| Model | Manifest id | Task | Tier | License | Extra |
|---|---|---|---|---|---|
| De-clip (cubic-spline) | `dsp-declip` | enhance | draft | MIT | *(none — DSP floor)* |
| De-hum (harmonic notch) | `dsp-dehum` | enhance | draft | MIT | *(none — DSP floor)* |
| Spectral-gate denoise | `dsp-denoise` | enhance | draft | MIT | *(none — DSP floor)* |
| Normalize (peak) | `dsp-normalize` | enhance | draft | MIT | *(none — DSP floor)* |
| RoFormer denoise | `denoise-roformer` | enhance | reference | MIT¹ | `neiro[separation]` |
| RoFormer dereverb | `dereverb-roformer` | enhance | reference | MIT¹ | `neiro[separation]` |
| AudioSR (bandwidth extension / super-resolution) | `audiosr` | enhance | reference | unknown — **verify before use** | `neiro[superres]` (Python ≤3.11) |
| Matchering (reference mastering) | `matchering` | enhance | reference | GPL-3.0 — copyleft, not bundled by default | `neiro[restoration]` |

`matchering`'s GPL-3.0 license is a stronger condition than the rest of the
engine's MIT code; it's an optional extra precisely so it never becomes a
mandatory dependency of the MIT-licensed core. `audiosr`'s manifest license is
marked `unknown` deliberately — check the upstream repository yourself before
relying on its output for anything beyond personal use, and treat the "unknown"
label as Neiro correctly refusing to guess rather than a bug.

## Transcription

| Model | Manifest id | Task | Tier | License | Extra |
|---|---|---|---|---|---|
| YIN + note segmentation (monophonic) | `dsp-yin` | transcribe | draft | MIT | *(none — DSP floor)* |
| Basic Pitch (Spotify, polyphonic) | `basic-pitch` | transcribe | standard | Apache-2.0 | `neiro[basicpitch]` (Python ≤3.11) |
| Piano transcription (Kong/ByteDance, with pedal) | `piano-transcription` | transcribe | reference | unknown — **verify before use** | `neiro[piano]` |

## Not yet registered (roadmap targets)

The full model zoo in [`roadmap.md`](../roadmap.md) §5.1/§6.1/§7.1 is larger than
what's wired today — SCNet-XL, Medley Vox, LarsNet, Apollo, Transkun, MIROS,
Whisper-based lyric transcription, and others remain **intentionally deferred**.
Adding one is a manifest + adapter PR; see
[`docs/adding-models.md`](adding-models.md) and open a
[model/adapter proposal issue](../.github/ISSUE_TEMPLATE/model_adapter.yml) first
if you want feedback on fit before writing code.

## Verifying the registry

```bash
neiro models                    # availability + download status on this machine
python scripts/verify_models.py # CI-equivalent manifest sanity check
```

`scripts/verify_models.py` checks that every manifest parses, names a real
adapter class, and declares the fields the registry and planner depend on — it's
the fastest way to validate a new manifest before opening a PR.
