import { stemColor, stemLabel } from './stemIdentity'

export { STEM_COLORS, stemColor, stemIcon, stemId, stemLabel, snapTime, transposeSuggestion } from './stemIdentity'

export type SeparatePresetGroupId =
  | 'vocals'
  | '4stem'
  | '6stem'
  | 'individual'
  | 'specialty'

export interface SeparatePreset {
  value: string
  label: string
  group: SeparatePresetGroupId
  intent: string
  detail: string
  /** Plain-language “connections” for the planner strip. */
  connections: string
}

export const SEPARATE_PRESET_GROUPS: {
  id: SeparatePresetGroupId
  label: string
}[] = [
  { id: 'vocals', label: 'Vocals + instrumental' },
  { id: '4stem', label: 'Classic 4-stem' },
  { id: '6stem', label: 'Classic 6-stem' },
  { id: 'individual', label: 'Individual / detect-all' },
  { id: 'specialty', label: 'Specialty' },
]

export const SEPARATE_PRESETS: SeparatePreset[] = [
  {
    value: 'vocals',
    label: 'vocals + instrumental',
    group: 'vocals',
    intent: 'Split lead vocal from the rest of the mix. Fast DSP path when neural models are absent.',
    detail:
      'Runs a centre-extract DSP floor first (always available), then upgrades to the best installed vocal model when present. Expect seconds on CPU for short clips; neural paths need a few GB VRAM. Use for karaoke prep, vocal editing, or a quick check before a heavier ensemble.',
    connections: 'This preset connects the mix → Vocals and Instrumental stems.',
  },
  {
    value: 'vocals-ensemble',
    label: 'vocals (DSP ensemble + TTA)',
    group: 'vocals',
    intent: 'Blend several DSP separators with test-time augmentation for cleaner vocals; slower.',
    detail:
      'Blends multiple DSP separators with polarity / mild TTA and averages the vocal mask. No neural download required. Roughly 2–4× a single DSP pass. Prefer when you want cleaner vocals without installing Demucs-class models.',
    connections: 'This preset connects the mix → Vocals and Instrumental (DSP ensemble blend).',
  },
  {
    value: 'vocals-neural-ensemble',
    label: 'vocals (neural ensemble)',
    group: 'vocals',
    intent: 'Blend neural separators for cleaner vocals; slower, needs installed models.',
    detail:
      'Runs two or more installed neural vocal models and fuses stems. Highest quality vocal isolation when models are present; multi-minute jobs and multi-GB VRAM are typical. Skip if only the DSP floor is installed — the planner will note missing members.',
    connections: 'This preset connects the mix → Vocals and Instrumental via neural ensemble fusion.',
  },
  {
    value: 'vocals-best',
    label: 'vocals (best available)',
    group: 'vocals',
    intent: 'Planner picks the strongest installed vocal model for this machine.',
    detail:
      'Lets the planner choose the highest-ranked available vocal separator for this host (neural if downloaded, else DSP). Good default when you care about quality but not which backend wins. Time and VRAM follow whatever model is selected.',
    connections: 'This preset connects the mix → Vocals and Instrumental using the best installed model.',
  },
  {
    value: 'karaoke',
    label: 'karaoke / lead vocal',
    group: 'vocals',
    intent: 'Isolate or remove the lead vocal for karaoke-style tracks; needs karaoke model.',
    detail:
      'Targets lead-vocal removal or isolation via a karaoke-oriented model when installed. Falls back to centre/sides DSP if the model is missing. Use for practice tracks and vocal-off mixes; expect bleed on heavily stereo leads.',
    connections: 'This preset connects the mix → Vocals and Instrumental (karaoke / lead focus).',
  },
  {
    value: '4stem',
    label: '4 stems',
    group: '4stem',
    intent: 'Vocals, drums, bass, other. Needs Demucs / HTDemucs installed.',
    detail:
      'Classic four-way split (vocals / drums / bass / other) via Demucs or HTDemucs when installed. Minutes per track on GPU; multi-GB weights. Use for remixing, transcription-after-split, and Studio multi-track load-in.',
    connections: 'This preset connects the mix → Vocals, Drums, Bass, and Other.',
  },
  {
    value: '6stem',
    label: '6 stems',
    group: '6stem',
    intent: 'Six-way Demucs split including guitar and piano. Needs htdemucs_6s.',
    detail:
      'Six-way HTDemucs (adds guitar and piano buses). Heavier than 4-stem; requires htdemucs_6s weights. Choose when guitar/piano isolation matters more than speed.',
    connections: 'This preset connects the mix → Vocals, Drums, Bass, Other, Guitar, and Piano.',
  },
  {
    value: 'detect-all',
    label: 'all detected (cascade)',
    group: 'individual',
    intent: 'Separate every asserted instrument via cascaded extract-subtract; residual last.',
    detail:
      'Cascades extract-subtract for each asserted instrument from analysis, leaving a residual. Runtime scales with instrument count and chosen backends. Best after confirming instruments in Analysis corrections.',
    connections:
      'This preset connects the mix → each asserted instrument in turn (cascade), then a residual.',
  },
  {
    value: 'harmonic',
    label: 'harmonic + percussive',
    group: 'specialty',
    intent: 'HPSS split — tones vs. attacks. No neural model required.',
    detail:
      'Median-filter HPSS (Fitzgerald): sustained harmonic content vs. transient/percussive. Pure DSP, fast on CPU, no VRAM. Ideal for drum vs. pitched-bus previews, remix prep, or feeding stem-aware analysis.',
    connections: 'This preset connects the mix → Harmonic and Percussive.',
  },
  {
    value: 'cinematic',
    label: 'cinematic (dialog / music / FX)',
    group: 'specialty',
    intent: 'Video-oriented split into dialog, music, and effects buses.',
    detail:
      'Dialog / music / FX buses for post and video stems. Uses cinematic-oriented models when installed; otherwise a coarse DSP proxy. Prefer for dialogue cleanup and soundtrack remixes, not music-only 4-stem work.',
    connections: 'This preset connects the mix → Dialog, Music, and FX.',
  },
  {
    value: 'drums',
    label: 'drum kit',
    group: 'specialty',
    intent: 'Break the drum bus into kit pieces. Needs drumsep model.',
    detail:
      'Splits a drum bus into kit-piece proxies (kick/snare/hats/… via drumsep when installed, else DSP band+transient floor). Feed a drum stem or dense mix; neural path needs the drumsep weights and modest GPU time.',
    connections: 'This preset connects drums → Kick, Snare, Toms, Hi-hat, Ride, and Crash.',
  },
  {
    value: 'duet-vocals',
    label: 'duet vocals',
    group: 'specialty',
    intent: 'Split two lead singers plus instrumental. Needs MedleyVox when available.',
    detail:
      'Targets Singer 1 / Singer 2 / Instrumental via MedleyVox when installed; otherwise falls back to a single vocal/instrumental split. Use for duets and harmony leads before Studio mashups.',
    connections: 'This preset connects the mix → Singer 1, Singer 2, and Instrumental.',
  },
  {
    value: 'drums-deep-dive',
    label: 'drums deep-dive',
    group: 'specialty',
    intent: 'Kit pieces plus bass/vocals/other residual buses — cascade specialty.',
    detail:
      'Deep drum cascade: kit pieces (kick/snare/toms/hats) plus drum_other, then bass, vocals, and other from the residual stack. Heavier than plain drum kit; use when you need both kit detail and mix context stems.',
    connections:
      'This preset connects the mix → Kick, Snare, Toms, Hi-hat, Drum other, Bass, Vocals, and Other.',
  },
]

export function presetsInGroup(group: SeparatePresetGroupId): SeparatePreset[] {
  return SEPARATE_PRESETS.filter((p) => p.group === group)
}

export function displayStemName(raw: string): string {
  return stemLabel(raw)
}

export function displayStemColor(raw: string): string {
  return stemColor(raw)
}

export const QUALITY_TIERS = [
  {
    value: 'draft',
    label: 'Draft',
    intent: 'Fast single model, low overlap, no TTA — for previews.',
    detail:
      'Single-pass, minimal overlap and no test-time augmentation. Lowest latency and VRAM — use for A/B previews, analysis draft splits, and checking routing before a Standard or Reference run.',
  },
  {
    value: 'standard',
    label: 'Standard',
    intent: 'Best single model with polarity TTA. Default for everyday work.',
    detail:
      'Best single available model with polarity TTA. Balanced quality vs. time; default for everyday separation. Expect roughly 1.5–2× Draft runtime when a neural model is active.',
  },
  {
    value: 'reference',
    label: 'Reference',
    intent: 'Ensemble + TTA + bleed suppression + residual accounting.',
    detail:
      'Ensemble members, TTA, bleed suppression, and residual accounting for archival-quality stems. Slowest and most VRAM-hungry; use when stems will be published or heavily edited.',
  },
] as const

export const TRANSCRIBE_MODES = [
  {
    value: 'auto',
    label: 'auto',
    intent: 'Planner chooses direct or split-first from the analysis and available models.',
  },
  {
    value: 'direct',
    label: 'direct (whole mix)',
    intent: 'Transcribe the full mix without separating first. Faster; messier when many instruments overlap.',
  },
  {
    value: 'split',
    label: 'split first',
    intent: 'Separate stems, then transcribe. Cleaner piano/melody when separation models are installed.',
  },
  {
    value: 'ensemble',
    label: 'ensemble / hybrid vote',
    intent:
      'Run selected (or default) decoders and fuse with weighted hybrid vote. Needs ≥2 installed members.',
  },
] as const

/**
 * NeuralNote-inspired quality presets for MIDI Studio → Transcribe.
 * Each picks a sensible mode + model; Advanced still lets you override both.
 */
export const TRANSCRIBE_QUALITY_PRESETS = [
  {
    value: 'draft',
    label: 'Draft',
    intent: 'Fast monophonic YIN — preview pitches before a heavier neural run.',
    mode: 'direct',
    model: 'dsp-yin',
  },
  {
    value: 'standard',
    label: 'Standard',
    intent: 'Planner picks the best installed decoder (auto split when helpful).',
    mode: 'auto',
    model: '',
  },
  {
    value: 'reference',
    label: 'Reference',
    intent: 'YourMT3+ → multi-instrument cascade (degrades to Basic Pitch / YIN if extras missing).',
    mode: 'direct',
    model: 'multi-instrument',
  },
  {
    value: 'ensemble',
    label: 'Ensemble',
    intent: 'Hybrid vote across installed members (default set or your checklist).',
    mode: 'ensemble',
    model: 'tr-ensemble-default',
  },
] as const

/** MIDI / symbolic decoders selectable in Transcribe (lyrics listed separately). */
export const TRANSCRIBE_MODELS = [
  {
    value: '',
    label: 'planner default',
    intent: 'Let the planner pick the best installed decoder for the mode and analysis.',
    ensembleMember: false,
    lyricsOnly: false,
  },
  {
    value: 'tr-ensemble-default',
    label: 'ensemble default',
    intent: 'Default member set (Basic Pitch + YIN + piano + drums-DSP when installed) with hybrid vote.',
    ensembleMember: false,
    lyricsOnly: false,
  },
  {
    value: 'yourmt3',
    label: 'YourMT3+',
    intent: 'Multi-instrument MT3-family decoder (whole mix). Needs neiro[mt3].',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'piano-transcription',
    label: 'piano (Kong / ByteDance)',
    intent: 'High-res piano with pedal and velocity. Needs neiro[piano].',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'transkun-piano',
    label: 'Transkun piano',
    intent: 'Semi-Markov CRF piano transcription. Needs the transkun package on PATH.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'basic-pitch',
    label: 'Basic Pitch',
    intent: 'Polyphonic multi-instrument transcription. Needs neiro[basicpitch].',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'multi-instrument',
    label: 'multi-instrument',
    intent: 'Whole-mix path: YourMT3 → omnizart → Basic Pitch / YIN floor.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'svt-melody',
    label: 'SVT melody',
    intent: 'Vocal / lead melody (SVT-class). Needs install; falls back to Basic Pitch / YIN.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'timbre-amt',
    label: 'TimbreAMT guitar',
    intent: 'Guitar AMT (opt-in). Needs neiro[timbre_amt] + package.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'dsp-yin',
    label: 'YIN (DSP)',
    intent: 'Fast monophonic pitch tracker. Always available; best for exposed melodies.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'drums-dsp',
    label: 'drums (DSP)',
    intent: 'Kit-piece onset classifier (spectral flux). Always available.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'drums-neural',
    label: 'drums (neural)',
    intent: 'Omnizart drum transcription. Needs omnizart + checkpoints.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'noise-to-notes',
    label: 'Noise-to-Notes drums',
    intent: 'Neural drum AMT (opt-in). Needs neiro[noise_to_notes] + package.',
    ensembleMember: true,
    lyricsOnly: false,
  },
  {
    value: 'whisper-lyrics',
    label: 'Whisper lyrics',
    intent: 'Lyrics ASR with decode timestamps — not MIDI notes. Needs openai-whisper.',
    ensembleMember: false,
    lyricsOnly: true,
  },
] as const

export const RESTORE_CHAINS = [
  {
    value: 'auto',
    label: 'Auto',
    intent: 'Apply only the repairs analysis flagged for this file.',
    detail:
      'Builds a DSP-safe chain from detected conditions (declip, declick, dehum). Neural steps such as denoise/dereverb/restore are suggested but not auto-downloaded. Fast and deterministic — start here.',
  },
  {
    value: 'clean',
    label: 'Clean recording',
    intent: 'Light cleanup for a mostly good take: clicks, hum, normalize.',
    detail:
      'declick → dehum → normalize. Pure DSP. Use when the recording is fine but has light clicks or mains hum.',
  },
  {
    value: 'old-noisy',
    label: 'Old & noisy',
    intent: 'Transfer / tape / room noise cleanup.',
    detail:
      'declick → dehum → denoise → normalize. Prefers a neural denoiser when installed; otherwise DSP gating. Good for hissy or crackly sources.',
  },
  {
    value: 'fix-clipping',
    label: 'Fix clipping',
    intent: 'Reconstruct clipped peaks, then normalize.',
    detail: 'declip → normalize. Pure DSP. Use when Analysis shows samples at the ceiling.',
  },
  {
    value: 'more-air',
    label: 'More air',
    intent: 'Bandwidth extension for dull / lossy sources.',
    detail:
      'restore → normalize. Uses Apollo/SonicMaster/AudioSR when installed; skipped honestly if missing. Prefer when bandwidth is well below Nyquist.',
  },
  {
    value: 'match-reference',
    label: 'Match reference',
    intent: 'Matchering loudness/EQ against a reference track.',
    detail:
      'master (Matchering) when installed. Finishing polish after repair — not a damage fixer.',
  },
] as const

export const EXPORT_FORMATS = [
  { id: 'wav16' as const, label: 'WAV 16-bit', intent: 'Compatible preview / DAW import.' },
  { id: 'wav24' as const, label: 'WAV 24-bit', intent: 'Full-resolution export for further editing.' },
  { id: 'flac' as const, label: 'FLAC', intent: 'Lossless compressed archive.' },
]

export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.000'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
