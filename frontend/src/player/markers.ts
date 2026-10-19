/** Markers and clips: the data model behind practice and the player timeline. */

export interface Marker {
  id: string
  time: number
  label: string
}

export interface Clip {
  id: string
  name: string
  start: number
  end: number
  countInBeats: number
  transpose: number
  pitchCents: number
  speed: number
  formant: number
  varispeed: boolean
  enabled: boolean
  loopCount: number
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function sortMarkers(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.time - b.time)
}

export function addMarker(markers: Marker[], time: number, label?: string): Marker[] {
  const marker: Marker = {
    id: newId('marker'),
    time: Math.max(0, time),
    label: label?.trim() || `Marker ${markers.length + 1}`,
  }
  return sortMarkers([...markers, marker])
}

export function removeMarker(markers: Marker[], id: string): Marker[] {
  return markers.filter((m) => m.id !== id)
}

export function nextMarker(markers: Marker[], time: number): Marker | null {
  return sortMarkers(markers).find((m) => m.time > time + 0.01) ?? null
}

export function previousMarker(markers: Marker[], time: number): Marker | null {
  const sorted = sortMarkers(markers)
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].time < time - 0.01) return sorted[i]
  }
  return null
}

export function clipAt(clips: Clip[], time: number): Clip | null {
  return clips.find((c) => c.enabled && time >= c.start && time < c.end) ?? null
}

export interface ClipSequenceEntry {
  clipId: string
  repeat: number
}

export interface SequencePosition {
  clip: Clip | null
  clipIndex: number
  localTime: number
  totalTime: number
}

/**
 * Resolve a sequence position from the concatenated timeline, honouring each
 * clip's loop count. Disabled clips are skipped.
 */
export function sequenceAt(clips: Clip[], time: number): SequencePosition {
  const enabled = clips.filter((c) => c.enabled && c.end > c.start)
  let elapsed = 0
  for (let i = 0; i < enabled.length; i += 1) {
    const clip = enabled[i]
    const length = (clip.end - clip.start) * Math.max(1, clip.loopCount)
    if (time < elapsed + length) {
      const within = time - elapsed
      const single = clip.end - clip.start
      return {
        clip,
        clipIndex: i,
        localTime: clip.start + (within % single),
        totalTime: elapsed + length,
      }
    }
    elapsed += length
  }
  return { clip: null, clipIndex: -1, localTime: 0, totalTime: elapsed }
}

export function sequenceDuration(clips: Clip[]): number {
  return clips
    .filter((c) => c.enabled && c.end > c.start)
    .reduce((sum, c) => sum + (c.end - c.start) * Math.max(1, c.loopCount), 0)
}

export function makeClip(start: number, end: number, overrides: Partial<Clip> = {}): Clip {
  const safeStart = Math.max(0, Math.min(start, end))
  const safeEnd = Math.max(safeStart + 0.1, end)
  return {
    id: newId('clip'),
    name: `Clip ${safeStart.toFixed(1)}–${safeEnd.toFixed(1)}`,
    start: safeStart,
    end: safeEnd,
    countInBeats: 0,
    transpose: 0,
    pitchCents: 0,
    speed: 1,
    formant: 1,
    varispeed: false,
    enabled: true,
    loopCount: 1,
    ...overrides,
  }
}

export type RampMode = 'chromatic' | 'fifths' | 'scale'
export type RampScale = 'major' | 'natural-minor' | 'harmonic-minor' | 'melodic-minor'

const SCALES: Record<RampScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
}

export interface RampOptions {
  mode: RampMode
  scale: RampScale
  fromSemitone: number
  toSemitone: number
  start: number
  end: number
  repetitions: number
  loopCount?: number
}

/** Generate practice clips across a pitch range (the "practice ramp"). */
export function buildRamp(options: RampOptions): Clip[] {
  const from = Math.min(options.fromSemitone, options.toSemitone)
  const to = Math.max(options.fromSemitone, options.toSemitone)
  let offsets: number[] = []
  if (options.mode === 'chromatic') {
    for (let st = from; st <= to; st += 1) offsets.push(st)
  } else if (options.mode === 'fifths') {
    const circle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]
    offsets = circle.map((st) => st + from).filter((st) => st <= to)
  } else {
    const degrees = SCALES[options.scale]
    const octaves = Math.floor((to - from) / 12) + 1
    for (let octave = 0; octave < octaves; octave += 1) {
      for (const degree of degrees) {
        const st = from + octave * 12 + degree
        if (st <= to) offsets.push(st)
      }
    }
  }
  if (!offsets.length) offsets = [0]
  const reps = Math.max(1, Math.round(options.repetitions || 1))
  const clips: Clip[] = []
  for (const offset of offsets) {
    for (let r = 0; r < reps; r += 1) {
      clips.push(
        makeClip(options.start, options.end, {
          name: `${offset >= 0 ? '+' : ''}${offset} st${reps > 1 ? ` (${r + 1}/${reps})` : ''}`,
          transpose: offset,
          loopCount: options.loopCount ?? 1,
        }),
      )
    }
  }
  return clips
}
