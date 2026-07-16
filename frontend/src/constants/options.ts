export const STEM_COLORS: Record<string, string> = {
  vocals: '#E69F00',
  instrumental: '#56B4E9',
  harmonic: '#009E73',
  percussive: '#D55E00',
  drums: '#D55E00',
  bass: '#0072B2',
  other: '#CC79A7',
  melody: '#E69F00',
  residual: '#8b93a1',
  guitar: '#F0E442',
  keys: '#009E73',
  piano: '#009E73',
  strings: '#56B4E9',
  winds: '#CC79A7',
}

export function stemColor(name: string): string {
  return STEM_COLORS[name.toLowerCase()] || '#F0E442'
}

export const SEPARATE_PRESETS = [
  {
    value: 'vocals',
    label: 'vocals + instrumental',
    intent: 'Split lead vocal from the rest of the mix. Fast DSP path when neural models are absent.',
    detail:
      'Runs a centre-extract DSP floor first (always available), then upgrades to the best installed vocal model when present. Expect seconds on CPU for short clips; neural paths need a few GB VRAM. Use for karaoke prep, vocal editing, or a quick check before a heavier ensemble.',
  },
  {
    value: 'vocals-ensemble',
    label: 'vocals (DSP ensemble + TTA)',
    intent: 'Blend several DSP separators with test-time augmentation for cleaner vocals; slower.',
    detail:
      'Blends multiple DSP separators with polarity / mild TTA and averages the vocal mask. No neural download required. Roughly 2–4× a single DSP pass. Prefer when you want cleaner vocals without installing Demucs-class models.',
  },
  {
    value: 'vocals-neural-ensemble',
    label: 'vocals (neural ensemble)',
    intent: 'Blend neural separators for cleaner vocals; slower, needs installed models.',
    detail:
      'Runs two or more installed neural vocal models and fuses stems. Highest quality vocal isolation when models are present; multi-minute jobs and multi-GB VRAM are typical. Skip if only the DSP floor is installed — the planner will note missing members.',
  },
  {
    value: 'vocals-best',
    label: 'vocals (best available)',
    intent: 'Planner picks the strongest installed vocal model for this machine.',
    detail:
      'Lets the planner choose the highest-ranked available vocal separator for this host (neural if downloaded, else DSP). Good default when you care about quality but not which backend wins. Time and VRAM follow whatever model is selected.',
  },
  {
    value: 'karaoke',
    label: 'karaoke / lead vocal',
    intent: 'Isolate or remove the lead vocal for karaoke-style tracks; needs karaoke model.',
    detail:
      'Targets lead-vocal removal or isolation via a karaoke-oriented model when installed. Falls back to centre/sides DSP if the model is missing. Use for practice tracks and vocal-off mixes; expect bleed on heavily stereo leads.',
  },
  {
    value: 'harmonic',
    label: 'harmonic + percussive',
    intent: 'HPSS split — tones vs. attacks. No neural model required.',
    detail:
      'Median-filter HPSS (Fitzgerald): sustained harmonic content vs. transient/percussive. Pure DSP, fast on CPU, no VRAM. Ideal for drum vs. pitched-bus previews, remix prep, or feeding stem-aware analysis.',
  },
  {
    value: '4stem',
    label: '4 stems',
    intent: 'Vocals, drums, bass, other. Needs Demucs / HTDemucs installed.',
    detail:
      'Classic four-way split (vocals / drums / bass / other) via Demucs or HTDemucs when installed. Minutes per track on GPU; multi-GB weights. Use for remixing, transcription-after-split, and Studio multi-track load-in.',
  },
  {
    value: '6stem',
    label: '6 stems',
    intent: 'Six-way Demucs split including guitar and piano. Needs htdemucs_6s.',
    detail:
      'Six-way HTDemucs (adds guitar and piano buses). Heavier than 4-stem; requires htdemucs_6s weights. Choose when guitar/piano isolation matters more than speed.',
  },
  {
    value: 'detect-all',
    label: 'all detected (cascade)',
    intent: 'Separate every asserted instrument via cascaded extract-subtract; residual last.',
    detail:
      'Cascades extract-subtract for each asserted instrument from analysis, leaving a residual. Runtime scales with instrument count and chosen backends. Best after confirming instruments in Analysis corrections.',
  },
  {
    value: 'cinematic',
    label: 'cinematic (dialog / music / FX)',
    intent: 'Video-oriented split into dialog, music, and effects buses.',
    detail:
      'Dialog / music / FX buses for post and video stems. Uses cinematic-oriented models when installed; otherwise a coarse DSP proxy. Prefer for dialogue cleanup and soundtrack remixes, not music-only 4-stem work.',
  },
  {
    value: 'drums',
    label: 'drum kit',
    intent: 'Break the drum bus into kit pieces. Needs drumsep model.',
    detail:
      'Splits a drum bus into kit-piece proxies (kick/snare/hats/… via drumsep when installed, else DSP band+transient floor). Feed a drum stem or dense mix; neural path needs the drumsep weights and modest GPU time.',
  },
] as const

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
    value: 'piano-transcription',
    label: 'piano (Kong)',
    intent: 'Specialized piano decoder with pedal and velocity. Needs neiro[piano].',
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
    value: 'dsp-yin',
    label: 'YIN (DSP)',
    intent: 'Fast monophonic pitch tracker. Always available; best for exposed melodies.',
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
    value: 'multi-instrument',
    label: 'multi-instrument',
    intent: 'Whole-mix multi-instrument path (omnizart when installed; else Basic Pitch / YIN floor).',
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
    label: 'auto (from analysis)',
    intent: 'Apply only the repairs the analysis flagged for this file.',
    detail:
      'Builds a DSP-safe conditioning chain from analysis flags (declip, dehum, …). Neural steps such as dereverb are suggested from stem-aware echo/delay but not auto-downloaded. Fast, deterministic across machines — start here.',
  },
  {
    value: 'declip,dehum,normalize',
    label: 'declip + dehum + normalize',
    intent: 'Fix clipped peaks, remove mains hum, then peak-normalize. Pure DSP.',
    detail:
      'Sequential DSP: reconstruct clipped peaks, notch mains hum (50/60 Hz), then peak-normalize. No neural weights. Use when Analysis shows clipping and/or hum and you want a clean floor before separation.',
  },
  {
    value: 'denoise',
    label: 'denoise',
    intent: 'Reduce broadband noise. Uses a neural model when installed; otherwise DSP denoise.',
    detail:
      'Broadband noise reduction. Prefers an installed neural denoiser; otherwise spectral gating. Modest GPU when neural; DSP path is CPU-only. Good for tape hiss and room noise before transcription.',
  },
  {
    value: 'dereverb',
    label: 'dereverb',
    intent: 'Reduce room reverb on the mix. Needs a dereverb model when available.',
    detail:
      'Targets room reverb / discrete echo. Pair with Analysis stem-aware delay flags (preview-split vocals/drums). Needs a dereverb model for best results; skipped honestly if missing. Prefer when RT60 or echo_delay_s is elevated.',
  },
  {
    value: 'superres',
    label: 'super-resolution',
    intent: 'Bandwidth extension via AudioSR. Needs AudioSR; skipped if not installed.',
    detail:
      'Bandwidth extension (AudioSR) for band-limited / lossy sources. Requires AudioSR installed; otherwise the step is skipped with a note. Use when Analysis bandwidth is well below Nyquist (e.g. <16 kHz on 44.1k material).',
  },
  {
    value: 'master',
    label: 'reference mastering',
    intent: 'Matchering reference loudness/EQ. Needs Matchering installed.',
    detail:
      'Reference-matched loudness/EQ via Matchering when installed. Provide a reference in CLI flows; UI uses the installed default path. Not a repair chain — finishing polish after Restore/Separate.',
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
