/** Stem display names, colors, and mashup key helpers. */

export const STEM_COLORS: Record<string, string> = {
  vocals: '#E69F00',
  vocal: '#E69F00',
  singer1: '#E69F00',
  singer2: '#F4A460',
  instrumental: '#56B4E9',
  harmonic: '#009E73',
  percussive: '#D55E00',
  drums: '#D55E00',
  kick: '#C44E00',
  snare: '#E07020',
  toms: '#B85A1A',
  hh: '#F0A060',
  hats: '#F0A060',
  ride: '#D4884A',
  crash: '#E8A060',
  drum_other: '#A05020',
  bass: '#0072B2',
  other: '#CC79A7',
  melody: '#E69F00',
  residual: '#8b93a1',
  guitar: '#F0E442',
  keys: '#009E73',
  piano: '#009E73',
  strings: '#56B4E9',
  winds: '#CC79A7',
  dialog: '#E69F00',
  music: '#56B4E9',
  fx: '#CC79A7',
  ref: '#8b93a1',
}

const STEM_LABELS: Record<string, string> = {
  vocals: 'Vocals',
  vocal: 'Vocals',
  singer1: 'Singer 1',
  singer2: 'Singer 2',
  instrumental: 'Instrumental',
  harmonic: 'Harmonic',
  percussive: 'Percussive',
  drums: 'Drums',
  kick: 'Kick',
  snare: 'Snare',
  toms: 'Toms',
  hh: 'Hi-hat',
  hats: 'Hi-hat',
  ride: 'Ride',
  crash: 'Crash',
  drum_other: 'Drum other',
  bass: 'Bass',
  other: 'Other',
  melody: 'Melody',
  residual: 'Residual',
  guitar: 'Guitar',
  keys: 'Keys',
  piano: 'Piano',
  strings: 'Strings',
  winds: 'Winds',
  dialog: 'Dialog',
  music: 'Music',
  fx: 'FX',
}

/** Canonical stem id from a track/file name (strips suffixes like " L"). */
export function stemId(name: string): string {
  const base = name.trim().toLowerCase().replace(/\s+\([a-z]+\)$/i, '')
  if (base.endsWith(' (ref)') || base.endsWith('(ref)')) return 'ref'
  const bare = base.replace(/\s+[lr]$/i, '').replace(/\s+copy$/i, '').trim()
  return bare.replace(/\s+/g, '_')
}

export function stemColor(name: string): string {
  const id = stemId(name)
  return STEM_COLORS[id] || STEM_COLORS[name.toLowerCase()] || '#F0E442'
}

export function stemLabel(name: string): string {
  const id = stemId(name)
  if (STEM_LABELS[id]) return STEM_LABELS[id]
  if (name.toLowerCase().includes('(ref)')) return 'Reference'
  // Title-case unknown ids: "drum_other" → "Drum other"
  return id
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Short glyph for stem badges (not emoji — ink-on-slate). */
const STEM_ICONS: Record<string, string> = {
  vocals: 'V',
  vocal: 'V',
  singer1: 'V1',
  singer2: 'V2',
  instrumental: 'I',
  harmonic: 'H',
  percussive: 'P',
  drums: 'D',
  kick: 'K',
  snare: 'Sn',
  toms: 'Tm',
  hh: 'Hh',
  hats: 'Hh',
  bass: 'B',
  other: 'O',
  guitar: 'G',
  keys: 'Ky',
  piano: 'Pn',
  strings: 'St',
  winds: 'W',
  residual: 'R',
  melody: 'M',
}

export function stemIcon(name: string): string {
  const id = stemId(name)
  if (STEM_ICONS[id]) return STEM_ICONS[id]
  const label = stemLabel(name)
  return label.slice(0, 2)
}

const NOTE_PC: Record<string, number> = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
}

/** Parse analysis key strings like "A minor" / "F# major" → pitch class 0–11. */
export function parseKeyPc(key: string | null | undefined): number | null {
  if (!key) return null
  const m = key.trim().match(/^([A-Ga-g](?:#|b)?)\s*(major|minor|maj|min)?/i)
  if (!m) return null
  const pc = NOTE_PC[m[1].toLowerCase()]
  return pc === undefined ? null : pc
}

export function isMinorKey(key: string | null | undefined): boolean {
  if (!key) return false
  return /min/i.test(key)
}

/**
 * Smallest signed semitone shift to map `fromKey` tonic onto `toKey` tonic.
 * Returns null when either key is unparseable.
 */
export function transposeSuggestion(
  fromKey: string | null | undefined,
  toKey: string | null | undefined,
): { semitones: number; label: string } | null {
  const a = parseKeyPc(fromKey)
  const b = parseKeyPc(toKey)
  if (a === null || b === null) return null
  let d = b - a
  if (d > 6) d -= 12
  if (d < -6) d += 12
  if (d === 0) return { semitones: 0, label: 'Keys already match' }
  const abs = Math.abs(d)
  const dir = d > 0 ? 'up' : 'down'
  return {
    semitones: d,
    label: `Transpose ${dir} ${abs} semitone${abs === 1 ? '' : 's'} (${fromKey} → ${toKey})`,
  }
}

/** Snap timeline seconds to the nearest beat (or bar) given BPM. */
export function snapTime(t: number, bpm: number, division: 'beat' | 'bar' = 'beat'): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return t
  const beat = 60 / bpm
  const cell = division === 'bar' ? beat * 4 : beat
  return Math.max(0, Math.round(t / cell) * cell)
}
