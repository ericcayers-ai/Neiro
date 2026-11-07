/**
 * MIDI target library — PianoVision adoption leg F, engine half.
 *
 * Pure TypeScript: no DOM, no window, no audio, no timers, no side effects.
 *
 * The leg's goal is "MIDI files become library items (title, difficulty derived from density,
 * channels, sections)". This module is the part that can be proved without a library UI: it turns the
 * repo's real target shape into the descriptor a library card needs, and it derives difficulty from
 * measurable density rather than taste.
 *
 * Input shape is the one leg A already consumes (do not invent a second one):
 * `TranscribeResult.tracks: Record<string, MidiEvent[]>` where
 * `MidiEvent { onset, offset, pitch, velocity, confidence }`
 * (frontend/src/api/types.ts), with the MIDI importer's `"{track}.drums"` convention for percussion
 * (src/neiro/symbolic/midi.py, `read_midi_notes`).
 */

/** One note in a track, matching `MidiEvent` from the API types (only the fields used here). */
export interface LibraryNote {
  onset: number
  offset?: number
  pitch: number
  velocity?: number
}

/** The repo's target map: track name -> notes. */
export type LibraryTarget = Record<string, LibraryNote[]>

/** Difficulty bands, low to high. The number is the band (1..5), the string is what a card shows. */
export const DIFFICULTY_BANDS = ['beginner', 'easy', 'moderate', 'hard', 'expert'] as const
export type DifficultyLabel = (typeof DIFFICULTY_BANDS)[number]

/**
 * Notes-per-second thresholds for each band.
 *
 * These are stated so the number can be argued with: below 1 note/s is a beginner piece, 1-2 easy,
 * 2-4 moderate, 4-7 hard, and anything denser is expert. A monophonic Bach minuet sits near 2; a fast
 * Chopin étude is well past 5.
 */
export const DIFFICULTY_THRESHOLDS = [1, 2, 4, 7] as const

export interface TargetDescriptor {
  /** Seconds from the first onset to the last note-off (or onset when no offsets exist). */
  durationSec: number
  noteCount: number
  /** Total notes / durationSec; 0 when the target is empty or zero-length. */
  notesPerSecond: number
  /** 1..5, from notesPerSecond via DIFFICULTY_THRESHOLDS. */
  difficulty: number
  difficultyLabel: DifficultyLabel
  /** Track names that carry notes, in the order the target lists them, percussion marked. */
  channels: string[]
  /** True when any track name ends in the importer's `.drums` suffix. */
  hasPercussion: boolean
  /** Lowest and highest pitch present; null when there are no notes. */
  pitchRange: { low: number; high: number } | null
  /** Largest number of notes sounding at the same instant (polyphony ceiling). */
  maxSimultaneous: number
  /** Distinct onset times, i.e. how many "events" a player actually has to play. */
  onsetCount: number
}

function notesOf(target: LibraryTarget): { track: string; note: LibraryNote }[] {
  const all: { track: string; note: LibraryNote }[] = []
  for (const [track, notes] of Object.entries(target)) {
    if (!Array.isArray(notes)) continue
    for (const note of notes) {
      if (!note || !Number.isFinite(note.onset) || !Number.isFinite(note.pitch)) continue
      all.push({ track, note })
    }
  }
  return all
}

/**
 * Largest number of notes sounding at once.
 *
 * Computed by sweeping onset/offset boundaries in time order (a note ending exactly when another
 * starts does not overlap, which is how the practice engine judges a legato line).
 */
export function maxSimultaneousNotes(target: LibraryTarget): number {
  type Boundary = { at: number; delta: number }
  const boundaries: Boundary[] = []
  for (const { note } of notesOf(target)) {
    const end = note.offset !== undefined && Number.isFinite(note.offset) ? note.offset : note.onset
    boundaries.push({ at: note.onset, delta: 1 })
    boundaries.push({ at: end, delta: -1 })
  }
  if (boundaries.length === 0) return 0
  // Ends sort before starts at the same instant, so a zero-length note cannot inflate the count.
  boundaries.sort((a, b) => a.at - b.at || a.delta - b.delta)
  let sounding = 0
  let peak = 0
  for (const boundary of boundaries) {
    sounding += boundary.delta;
    if (sounding > peak) peak = sounding
  }
  return peak
}

/** Band for a density, clamped to the 1..5 range. */
export function difficultyForDensity(notesPerSecond: number): number {
  if (!Number.isFinite(notesPerSecond) || notesPerSecond <= 0) return 1
  let band = 1
  for (const threshold of DIFFICULTY_THRESHOLDS) {
    if (notesPerSecond > threshold) band += 1
  }
  return Math.min(DIFFICULTY_THRESHOLDS.length + 1, band)
}

/**
 * Describe a target the way a library card needs it.
 *
 * `title` is not derived: a MIDI file's name is the caller's to supply (it comes from the file, not
 * from the notes), so it is deliberately absent from this descriptor rather than guessed here.
 */
export function describeTarget(target: LibraryTarget): TargetDescriptor {
  const notes = notesOf(target)
  const channels = Object.keys(target).filter(
    (track) => Array.isArray(target[track]) && target[track].length > 0,
  );
  const hasPercussion = channels.some((track) => track.endsWith('.drums'))

  if (notes.length === 0) {
    return {
      durationSec: 0,
      noteCount: 0,
      notesPerSecond: 0,
      difficulty: 1,
      difficultyLabel: DIFFICULTY_BANDS[0],
      channels,
      hasPercussion,
      pitchRange: null,
      maxSimultaneous: 0,
      onsetCount: 0,
    }
  }

  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  const onsets = new Set<number>()
  for (const { note } of notes) {
    if (note.onset < start) start = note.onset
    const noteEnd = note.offset !== undefined && Number.isFinite(note.offset) ? note.offset : note.onset
    if (noteEnd > end) end = noteEnd
    if (note.pitch < low) low = note.pitch
    if (note.pitch > high) high = note.pitch
    onsets.add(note.onset)
  }

  const durationSec = Math.max(0, end - start)
  const notesPerSecond = durationSec > 0 ? notes.length / durationSec : 0
  const difficulty = difficultyForDensity(notesPerSecond)

  return {
    durationSec,
    noteCount: notes.length,
    notesPerSecond,
    difficulty,
    difficultyLabel: DIFFICULTY_BANDS[difficulty - 1],
    channels,
    hasPercussion,
    pitchRange: { low, high },
    maxSimultaneous: maxSimultaneousNotes(target),
    onsetCount: onsets.size,
  }
}

/**
 * The transport length of a target: the last moment anything sounds.
 *
 * `describeTarget().durationSec` is the *span* between the first onset and the last offset, which is
 * what a card wants (density). A transport wants absolute target time from 0, because that is the
 * clock the roll and the practice engine judge against — a target whose first note is at 5 s must not
 * end its transport 5 s early. Returns 0 for an empty target.
 */
export function targetEndSec(target: LibraryTarget): number {
  let end = 0
  for (const { note } of notesOf(target)) {
    const noteEnd =
      note.offset !== undefined && Number.isFinite(note.offset) ? Math.max(note.offset, note.onset) : note.onset
    if (noteEnd > end) end = noteEnd
  }
  return end
}

/**
 * Whether a descriptor looks like a real piece rather than a fragment.
 *
 * The library should not offer a three-note file as a practice target, and it should say why rather
 * than showing an empty card. Returns a reason string when the target is too small, else null.
 */
export function whyTooSmallToPractise(
  descriptor: TargetDescriptor,
  minimum: { notes?: number; seconds?: number } = { notes: 8, seconds: 2 },
): string | null {
  const minNotes = minimum.notes ?? 0
  const minSeconds = minimum.seconds ?? 0
  if (descriptor.noteCount === 0) return 'this file carries no notes'
  if (descriptor.noteCount < minNotes) {
    return `only ${descriptor.noteCount} note${descriptor.noteCount === 1 ? '' : 's'} — needs at least ${minNotes}`
  }
  if (descriptor.durationSec < minSeconds) {
    return `only ${descriptor.durationSec.toFixed(1)} s long — needs at least ${minSeconds} s`
  }
  return null
}
