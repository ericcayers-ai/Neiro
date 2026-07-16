# Model registry

Every model Neiro can use is a JSON manifest under `src/neiro/manifests/`, scanned
by `neiro.engine.registry` at startup. A manifest is a *reference*, not a bundled
dependency: no weights ship in this repository, and the pure-DSP entries need no
weights at all. Run `neiro models` for the live, machine-specific view (it adds
`AVAIL`/`DOWNL` columns for your environment); this page is the human-readable
catalog plus the licensing detail that matters before you rely on a model's output.

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
| Drum-kit DSP floor | `dsp-drumkit` | kick, snare, toms, hh, ride, crash | draft | MIT | *(none — DSP floor)* |
| BS-RoFormer (viperx 1297) | `bs-roformer-1297` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| BS-RoFormer (viperx 1296) | `bs-roformer-1296` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| BS-RoFormer SW | `bs-roformer-sw` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer (instrumental) | `mel-roformer-inst` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer Kim | `mel-roformer-kim` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer Kim FT3 | `mel-roformer-kim-ft` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| Mel-RoFormer Karaoke | `mel-roformer-karaoke` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| MDX-B Karaoke | `mdx-b-karaoke` | vocals, instrumental | standard | MIT¹ | `neiro[separation]` |
| VR Arch Karaoke | `vr-karaoke` | vocals, instrumental | standard | MIT¹ | `neiro[separation]` |
| MDX23C inst/voc | `mdx23c-instvoc` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| MDX23C 8KFFT HQ | `mdx23c-8kfft` | vocals, instrumental | reference | MIT¹ | `neiro[separation]` |
| MDX23C drumsep | `mdx23c-drumsep` | kick, snare, toms, hh, ride, crash | reference | MIT¹ | `neiro[separation]` |
| LarsNet (drum kit, opt-in) | `larsnet` | kick, snare, toms, hh, cymbals | reference | unknown | `neiro[larsnet]` + checkpoint |
| HTDemucs v4 fine-tuned | `htdemucs-ft` | vocals, drums, bass, other | standard | MIT | `neiro[separation]` or `neiro[demucs]` |
| HTDemucs 6-stem | `htdemucs-6s` | vocals, drums, bass, guitar, piano, other | standard | MIT | `neiro[separation]` |
| Demucs3 MMI | `hdemucs-mmi` | vocals, drums, bass, other | standard | MIT | `neiro[separation]` |
| Demucs (direct package) | `demucs-direct` | vocals, drums, bass, other | standard | MIT | `neiro[demucs]` |
| SCNet / SCNet-XL / XL-IHF | `scnet`, `scnet-xl`, `scnet-xl-ihf` | 4-stem | reference | unknown | `neiro[scnet]` + checkpoint |
| Chorus Male/Female (Medley Vox class) | `medley-vox` | singer1, singer2 | reference | MIT¹ | `neiro[separation]` |
| Kim Vocal 2 | `kim-vocal-2` | vocals, instrumental | standard | MIT¹ | `neiro[separation]` |
| UVR MDX Inst HQ 5 | `uvr-mdx-inst-hq5` | vocals, instrumental | standard | MIT¹ | `neiro[separation]` |
| Kuielab bass / drums / vocals / other | `kuielab-*` | instrument + complement | standard | MIT¹ | `neiro[separation]` |
| VR Arch woodwinds | `wind-inst` | woodwinds, no_woodwinds | standard | MIT¹ | `neiro[separation]` |
| Crowd removal (RoFormer / MDX) | `crowd-roformer`, `crowd-mdx` | no_crowd, crowd | reference | MIT¹ | `neiro[separation]` |
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
| De-click | `dsp-declick` | enhance | draft | MIT | *(none — DSP floor)* |
| Vocal repair (DSP) | `dsp-vocal-repair` | enhance | draft | MIT | *(none — DSP floor)* |
| Normalize (peak) | `dsp-normalize` | enhance | draft | MIT | *(none — DSP floor)* |
| RoFormer denoise | `denoise-roformer` | enhance | reference | MIT¹ | `neiro[separation]` |
| VR Arch denoise | `vr-denoise` | enhance | standard | MIT¹ | `neiro[separation]` |
| DeepFilterNet | `deepfilternet` | enhance | reference | MIT | `neiro[deepfilternet]` |
| RoFormer dereverb | `dereverb-roformer` | enhance | reference | MIT¹ | `neiro[separation]` |
| VR Arch dereverb / de-echo | `vr-dereverb`, `vr-deecho` | enhance | standard | MIT¹ | `neiro[separation]` |
| Aspiration / de-breath | `aspiration-roformer` | enhance | reference | MIT¹ | `neiro[separation]` |
| Bleed suppressor | `bleed-suppressor` | enhance | reference | MIT¹ | `neiro[separation]` |
| VoiceFixer | `voicefixer` | enhance | reference | unknown — **verify** | `neiro[voicefixer]` |
| Apollo (lossy-codec restore) | `apollo` | enhance | reference | unknown — **verify** | `neiro[apollo]` + look2hear from JusperLee/Apollo |
| SonicMaster | `sonicmaster` | enhance | reference | unknown | `neiro[sonicmaster]` + checkpoint |
| AudioSR (bandwidth extension) | `audiosr` | enhance | reference | unknown — **verify before use** | `neiro[superres]` (Python ≤3.11) |
| Matchering (reference mastering) | `matchering` | enhance | reference | GPL-3.0 — copyleft, not bundled by default | `neiro[restoration]` |

`matchering`'s GPL-3.0 license is a stronger condition than the rest of the
engine's MIT code; it's an optional extra precisely so it never becomes a
mandatory dependency of the MIT-licensed core. `audiosr` / `apollo` /
`voicefixer` licenses are marked carefully — check upstream before commercial use.

## Transcription

| Model | Manifest id | Task | Tier | License | Extra |
|---|---|---|---|---|---|
| YIN + note segmentation (monophonic) | `dsp-yin` | transcribe | draft | MIT | *(none — DSP floor)* |
| Basic Pitch (Spotify, polyphonic) | `basic-pitch` | transcribe | standard | Apache-2.0 | `neiro[basicpitch]` (Python ≤3.11) |
| Piano transcription (Kong/ByteDance) | `piano-transcription` | transcribe | reference | unknown — **verify** | `neiro[piano]` |
| Transkun v2 piano | `transkun-piano` | transcribe | reference | unknown — **verify** | `neiro[transkun]` |
| YourMT3+ (MT3 family) | `yourmt3` | transcribe | reference | Apache-2.0 | `neiro[mt3]` |
| Multi-instrument (YourMT3 → omnizart → Basic Pitch) | `multi-instrument` | transcribe | standard | MIT | *(degrades; best with `neiro[mt3]`)* |
| SVT-class vocal melody | `svt-melody` | transcribe | standard | MIT | *(Basic Pitch / YIN fallback; speechbrain optional)* |
| TimbreAMT guitar (opt-in) | `timbre-amt` | transcribe | reference | unknown | `neiro[timbre_amt]` + package |
| Drums DSP / neural | `drums-dsp`, `drums-neural` | transcribe | draft / standard | MIT | `drums-neural`: `neiro[omnizart]` |
| Noise-to-Notes drums (opt-in) | `noise-to-notes` | transcribe | reference | unknown | `neiro[noise_to_notes]` + package |
| Whisper lyrics | `whisper-lyrics` | transcribe | standard | MIT | `neiro[lyrics]` |

## Planner wiring

Presets (`neiro separate --preset …`) and enhancement chain steps resolve through
ordered prefer lists in `neiro.engine.planner`:

- **vocals-best** — ensemble → BS-RoFormer SW/1297 → Mel-RoFormer Kim → MDX23C → DSP
- **karaoke** — Mel karaoke → MDX-B → VR karaoke → DSP
- **duet-vocals** — Medley/chorus male-female → karaoke → DSP (residual = bed)
- **4stem** — SCNet-XL (if configured) → HTDemucs / Demucs3 MMI
- **6stem** — BS-RoFormer SW → HTDemucs 6s
- **drums** — LarsNet (if configured) → MDX23C drumsep → DSP kit
- **bass / guitar / piano / woodwinds / crowd** — family isolators
- **Enhancement steps** — `denoise`, `dereverb`, `deecho`, `debreath`, `bleed`,
  `crowd`, `vocal-repair`, `restore`, `apollo`, `voicefixer`, `superres`, `master`

Instrument → decoder routing lives in `neiro.symbolic.router` (Transkun / YourMT3 /
TimbreAMT / Noise-to-Notes / SVT / Whisper lyrics).

## Research / opt-in checkpoints

These registry entries are real adapters with honest `available()` gating. They
need a user-supplied package and/or checkpoint because upstream does not ship a
verified-license pip wheel with weights:

- `scnet`, `scnet-xl`, `scnet-xl-ihf`
- `larsnet`
- `sonicmaster`
- `timbre-amt`
- `noise-to-notes`
- `apollo` (needs `look2hear` from [JusperLee/Apollo](https://github.com/JusperLee/Apollo))

Until configured, every preset that lists them falls through to the next
installable model (usually an `audio-separator` checkpoint or the DSP floor).

## Verifying the registry

```bash
neiro models                    # availability + download status on this machine
python scripts/verify_models.py # CI-equivalent manifest sanity check
```

`scripts/verify_models.py` checks that every manifest parses, names a real
adapter class, and declares the fields the registry and planner depend on — it's
the fastest way to validate a new manifest before opening a PR.
