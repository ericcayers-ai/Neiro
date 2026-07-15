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
  },
  {
    value: 'vocals-ensemble',
    label: 'vocals (DSP ensemble + TTA)',
    intent: 'Blend several DSP separators with test-time augmentation for cleaner vocals; slower.',
  },
  {
    value: 'vocals-neural-ensemble',
    label: 'vocals (neural ensemble)',
    intent: 'Blend neural separators for cleaner vocals; slower, needs installed models.',
  },
  {
    value: 'vocals-best',
    label: 'vocals (best available)',
    intent: 'Planner picks the strongest installed vocal model for this machine.',
  },
  {
    value: 'karaoke',
    label: 'karaoke / lead vocal',
    intent: 'Isolate or remove the lead vocal for karaoke-style tracks; needs karaoke model.',
  },
  {
    value: 'harmonic',
    label: 'harmonic + percussive',
    intent: 'HPSS split — tones vs. attacks. No neural model required.',
  },
  {
    value: '4stem',
    label: '4 stems',
    intent: 'Vocals, drums, bass, other. Needs Demucs / HTDemucs installed.',
  },
  {
    value: '6stem',
    label: '6 stems',
    intent: 'Six-way Demucs split including guitar and piano. Needs htdemucs_6s.',
  },
  {
    value: 'detect-all',
    label: 'all detected (cascade)',
    intent: 'Separate every asserted instrument via cascaded extract-subtract; residual last.',
  },
  {
    value: 'cinematic',
    label: 'cinematic (dialog / music / FX)',
    intent: 'Video-oriented split into dialog, music, and effects buses.',
  },
  {
    value: 'drums',
    label: 'drum kit',
    intent: 'Break the drum bus into kit pieces. Needs drumsep model.',
  },
] as const

export const QUALITY_TIERS = [
  {
    value: 'draft',
    label: 'Draft',
    intent: 'Fast single model, low overlap, no TTA — for previews.',
  },
  {
    value: 'standard',
    label: 'Standard',
    intent: 'Best single model with polarity TTA. Default for Simple mode.',
  },
  {
    value: 'reference',
    label: 'Reference',
    intent: 'Ensemble + TTA + bleed suppression + residual accounting.',
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
] as const

export const TRANSCRIBE_MODELS = [
  {
    value: '',
    label: 'planner default',
    intent: 'Let the planner pick the best installed decoder for the mode and analysis.',
  },
  {
    value: 'piano-transcription',
    label: 'piano (Kong)',
    intent: 'Specialized piano decoder with pedal and velocity. Needs neiro[piano].',
  },
  {
    value: 'basic-pitch',
    label: 'Basic Pitch',
    intent: 'Polyphonic multi-instrument transcription. Needs neiro[basicpitch].',
  },
  {
    value: 'dsp-yin',
    label: 'YIN (DSP)',
    intent: 'Fast monophonic pitch tracker. Always available; best for exposed melodies.',
  },
  {
    value: 'transkun',
    label: 'Transkun-class piano',
    intent: 'Semi-Markov piano transcription when the adapter is installed.',
  },
  {
    value: 'whisper-lyrics',
    label: 'Whisper lyrics',
    intent: 'Lyrics ASR with forced alignment when Whisper extras are installed.',
  },
] as const

export const RESTORE_CHAINS = [
  {
    value: 'auto',
    label: 'auto (from analysis)',
    intent: 'Apply only the repairs the analysis flagged for this file.',
  },
  {
    value: 'declip,dehum,normalize',
    label: 'declip + dehum + normalize',
    intent: 'Fix clipped peaks, remove mains hum, then peak-normalize. Pure DSP.',
  },
  {
    value: 'denoise',
    label: 'denoise',
    intent: 'Reduce broadband noise. Uses a neural model when installed; otherwise DSP denoise.',
  },
  {
    value: 'dereverb',
    label: 'dereverb',
    intent: 'Reduce room reverb on the mix. Needs a dereverb model when available.',
  },
  {
    value: 'superres',
    label: 'super-resolution',
    intent: 'Bandwidth extension via AudioSR. Needs AudioSR; skipped if not installed.',
  },
  {
    value: 'master',
    label: 'reference mastering',
    intent: 'Matchering reference loudness/EQ. Needs Matchering installed.',
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
