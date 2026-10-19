/** Player parameter model, clamps, presets, and the honest method label. */

export interface EqBand {
  freq: number
  gain: number
}

export interface PlayerParams {
  transpose: number
  pitchCents: number
  speed: number
  formant: number
  varispeed: boolean
  eq: number[]
  reducer: number
  gainDb: number
  bypass: boolean
  metronome: boolean
  metronomeBpm: number
  countInBeats: number
  loopEnabled: boolean
  waitMode: 'off' | 'key' | 'midi'
}

export const EQ_FREQS = [60, 170, 350, 1000, 3500, 10000]

export const DEFAULT_PARAMS: PlayerParams = {
  transpose: 0,
  pitchCents: 0,
  speed: 1,
  formant: 1,
  varispeed: false,
  eq: [0, 0, 0, 0, 0, 0],
  reducer: 0,
  gainDb: 0,
  bypass: false,
  metronome: false,
  metronomeBpm: 100,
  countInBeats: 4,
  loopEnabled: false,
  waitMode: 'off',
}

export const SPEED_RANGE = { min: 0.25, max: 4 }
export const TRANSPOSE_RANGE = { min: -36, max: 36 }
export const FORMANT_RANGE = { min: 0.2, max: 2 }

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeParams(input: Partial<PlayerParams>): PlayerParams {
  return {
    ...DEFAULT_PARAMS,
    ...input,
    transpose: clamp(Number(input.transpose ?? 0), TRANSPOSE_RANGE.min, TRANSPOSE_RANGE.max),
    pitchCents: clamp(Number(input.pitchCents ?? 0), -100, 100),
    speed: clamp(Number(input.speed ?? 1), SPEED_RANGE.min, SPEED_RANGE.max),
    formant: clamp(Number(input.formant ?? 1), FORMANT_RANGE.min, FORMANT_RANGE.max),
    eq: EQ_FREQS.map((_, i) => clamp(Number(input.eq?.[i] ?? 0), -15, 15)),
    reducer: clamp(Number(input.reducer ?? 0), 0, 1),
    gainDb: clamp(Number(input.gainDb ?? 0), -24, 12),
    metronome: Boolean(input.metronome ?? false),
    metronomeBpm: clamp(Number(input.metronomeBpm ?? 100), 30, 300),
  }
}

export interface EqPreset {
  id: string
  label: string
  gains: number[]
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass lift', gains: [6, 4, 2, 0, 0, 0] },
  { id: 'vocal', label: 'Vocal presence', gains: [-2, -1, 0, 2, 3, 2] },
  { id: 'telephone', label: 'Telephone', gains: [-12, -6, 0, 4, 2, -6] },
  { id: 'deharsh', label: 'De-harsh', gains: [0, 0, 0, -2, -4, -2] },
]

/** Reference pitch presets, in Hz (A4). Tuning is applied as a cents offset. */
export const TUNING_PRESETS = [
  { id: 'concert', label: 'Concert 440', hz: 440 },
  { id: 'baroque', label: 'Baroque 415', hz: 415 },
  { id: 'classical', label: 'Classical 430', hz: 430 },
  { id: 'chorton', label: 'Chorton 466', hz: 466 },
  { id: 'scientific', label: 'Scientific 432', hz: 432 },
]

export function tuningToCents(hz: number): number {
  return 1200 * Math.log2(hz / 440)
}

export type QualityMode = 'preview' | 'rendered' | 'fallback'

export interface MethodLabel {
  mode: QualityMode
  label: string
  detail: string
}

/**
 * The UI must show what is actually running. A phase-vocoder preview is never
 * called "Rubber Band" or simply "pitch-preserving"; a browser resample fallback
 * says so.
 */
export function describeMethod(params: PlayerParams, mode: QualityMode = 'preview'): MethodLabel {
  if (mode === 'fallback') {
    return {
      mode,
      label: 'Fallback (browser playbackRate)',
      detail: 'WASM/worklet unavailable: pitch changes with speed and is not preserved.',
    }
  }
  if (mode === 'rendered') {
    return {
      mode,
      label: 'Rendered (Neiro engine)',
      detail: 'Offline render from the Python engine; provenance reported per job.',
    }
  }
  if (params.bypass) {
    return { mode, label: 'Preview (bypass)', detail: 'DSP bypassed; audio is unmodified.' }
  }
  const parts = ['phase-vocoder preview']
  if (params.speed !== 1) parts.push(`speed ${Math.round(params.speed * 100)}%`)
  if (params.transpose !== 0 || params.pitchCents !== 0) {
    parts.push(`pitch ${params.transpose >= 0 ? '+' : ''}${params.transpose} st`)
  }
  if (params.varispeed) parts.push('varispeed')
  if (params.formant !== 1) parts.push(`formant ×${params.formant.toFixed(2)}`)
  return {
    mode,
    label: 'Preview (clean-room phase vocoder)',
    detail: `${parts.join(' · ')}. For the rendered quality path, queue a Neiro job.`,
  }
}
