/**
 * Practice engine core — PianoVision adoption leg A.
 *
 * Pure TypeScript: no DOM, no `window`, no audio, no timers, no side effects.
 * Takes the repo's real MIDI target (the `TranscribeResult.tracks` note map the
 * practice panel already renders, or the Python-side `NoteEvent` stream) plus a
 * stream of observed note-on events, and returns per-note judgements, extra
 * messages, a wait-gate decision and a scored "practise these sections" list.
 *
 * Real data shapes this module matches (do not invent alternatives):
 * - Target, frontend: `TranscribeResult.tracks: Record<string, MidiEvent[]>`
 *   where `MidiEvent { onset, offset, pitch, velocity, confidence }`
 *   (frontend/src/api/types.ts, `MidiEvent`).
 * - Target, engine side: `NoteEvent { onset, offset, pitch, velocity, ...,
 *   track }` (src/neiro/engine/artifacts.py, `NoteEvent`); the MIDI importer
 *   `read_midi_notes` (src/neiro/symbolic/midi.py) tags percussion channels as
 *   `"{track}.drums"`, otherwise the track key survives.
 * - Observed, player: `parseMidiMessage` returns `{ type: 'note', channel,
 *   number, value }` (frontend/src/player/midi.ts); the WebMIDI wait gate reads
 *   `data[0]&0xf0 === 0x90`, `note = data[1]`, `velocity = data[2]`
 *   (frontend/src/player/PlayerSurface.tsx); the DAW injector bridge delivers
 *   `onMidiNoteOn(pitch, velocity, instanceId)`
 *   (frontend/src/modules/midi/MidiPracticePanel.tsx).
 * - Existing wait-gate semantics being generalised: `Transport.waitPoints` is a
 *   sorted list of stop times; `tick()` stops at a point and only `resume()`
 *   (a matching pitch, Space/Enter, or the DAW panel token) continues
 *   (frontend/src/player/Transport.ts, PlayerSurface.tsx `waitPointsFromNotes`
 *   dedupes simultaneous notes of a chord into one wait point).
 * - Sections reuse the existing marker model `{ id, time, label }`
 *   (frontend/src/player/markers.ts, `Marker`).
 */

export type Hand = 'left' | 'right' | 'unknown'

export type NoteState = 'hit' | 'missed' | 'early' | 'late' | 'pending'

/** A judgement against one target note. */
export interface JudgedNote {
  note: TargetNote
  state: NoteState
  /** observed.timeSec - note.startSec, in ms; only set when matched. */
  deltaMs?: number
  /** Index into the observed stream that matched; only set when matched. */
  observedIndex?: number
}

/** Default tolerance: |delta| <= this counts as `hit`. */
export const DEFAULT_HIT_WINDOW_MS = 150
/** Default: how early a note may be played and still match as `early`. */
export const DEFAULT_EARLY_WINDOW_MS = 300
/** Default: how late a note may be played and still match as `late`. */
export const DEFAULT_LATE_WINDOW_MS = 500
/** Default: how far ahead of the transport position a wait gate looks. */
export const DEFAULT_WAIT_LOOKAHEAD_SEC = 2.0

const MS_PER_SEC = 1000

export interface TargetNote {
  /** `MidiEvent.onset` / `NoteEvent.onset`, seconds. */
  startSec: number
  /** `MidiEvent.offset` / `NoteEvent.offset`, seconds. */
  endSec: number
  /** `MidiEvent.pitch` / MIDI note number. */
  midi: number
  /** `MidiEvent.velocity`. */
  velocity: number
  /** The `TranscribeResult.tracks` key (or `NoteEvent.track`). */
  track: string
  hand: Hand
  /** Position in the parsed target, in `startSec` order. */
  index: number
}

/** Raw target event, accepting both repo shapes. "confidence" is part of the
 * frontend `MidiEvent`; "channel" is not (the engine-side MIDI import only
 * keeps it inside the track name), so it is a convenience field. */
export interface RawTargetEvent {
  onset: number
  offset: number
  pitch: number
  velocity: number
  confidence?: number
  channel?: number
}

/**
 * A played note-on. From the player's real messages:
 * `midi` = parseMidiMessage().number / WebMIDI `data[1]`; `timeSec` is the
 * transport position (musical seconds) at which the note-on arrived; `channel`
 * and `velocity` are optional extras from the same sources.
 */
export interface ObservedNote {
  timeSec: number
  midi: number
  velocity?: number
  channel?: number
}

export interface HandOptions {
  /** Documented override: exact track key -> hand. Wins over everything else. */
  handByTrack?: Record<string, Hand>
  /** Documented override: MIDI channel number -> hand. */
  handByChannel?: Record<number, Hand>
}

export interface ParseTargetOptions extends HandOptions {}

/**
 * Default hand convention (PianoVision splits by channel): channel 1 is the
 * left hand, channel 0 the right. Anything else is `unknown`. Track names that
 * mention a hand (`left`/`LH`/`hand L`, `right`/`RH`/`hand R`, case-insensitive)
 * count as a weaker signal than the explicit maps.
 */
function handFor(track: string, channel: number | undefined, options: HandOptions): Hand {
  if (options.handByTrack && track in options.handByTrack) return options.handByTrack[track]
  if (channel != null && options.handByChannel && channel in options.handByChannel) {
    return options.handByChannel[channel]
  }
  if (/(\bleft|\blh\b|hand\s*l)/i.test(track)) return 'left'
  if (/(\bright|\brh\b|hand\s*r)/i.test(track)) return 'right'
  if (channel === 1) return 'left'
  if (channel === 0) return 'right'
  return 'unknown'
}

/**
 * Build the target from today's real shape: the `TranscribeResult.tracks`
 * record (frontend) or an equivalent `NoteEvent`-per-track map (engine).
 * Output is sorted by `startSec`; `index` follows that order.
 */
export function parseTarget(
  tracks: Record<string, readonly (RawTargetEvent & { track?: string })[]>,
  options: ParseTargetOptions = {},
): TargetNote[] {
  const out: TargetNote[] = []
  for (const [track, events] of Object.entries(tracks)) {
    if (!Array.isArray(events)) continue
    for (const event of events) {
      if (!event || !Number.isFinite(event.onset) || !Number.isFinite(event.offset)) continue
      const startSec = event.onset
      out.push({
        startSec,
        endSec: Math.max(event.offset, startSec),
        midi: event.pitch,
        velocity: event.velocity,
        track,
        hand: handFor(track, event.channel, options),
        index: 0,
      })
    }
  }
  out.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
  for (let i = 0; i < out.length; i += 1) out[i].index = i
  return out
}

export interface MatchOptions {
  hitWindowMs?: number
  earlyWindowMs?: number
  lateWindowMs?: number
  /** Only judge notes of this hand ('all' = default). */
  hand?: Hand
  /**
   * Evaluation position in seconds. Given (live/partially played): unmatched
   * target notes whose matchable window opens later than `atSec` are `pending`,
   * earlier ones `missed`. Omitted (a complete pass): every unmatched note is
   * `missed`, i.e. the run is treated as having reached the end of the piece.
   */
  atSec?: number
}

export interface MatchResult {
  /** One judgement per target note (filtered by `hand`), in `startSec` order. */
  notes: JudgedNote[]
  /** Played notes that matched no target note inside its window. */
  extras: ObservedNote[]
}

interface MatchWindows {
  hitMs: number
  openMs: number // early side of the matchable window
  closeMs: number // late side of the matchable window
}

function resolveWindows(options: MatchOptions | undefined): MatchWindows {
  const o = options ?? {}
  const hitMs = o.hitWindowMs ?? DEFAULT_HIT_WINDOW_MS
  // The matchable window must never be tighter than the hit tolerance.
  return {
    hitMs: Math.max(0, hitMs),
    openMs: Math.max(hitMs, o.earlyWindowMs ?? DEFAULT_EARLY_WINDOW_MS),
    closeMs: Math.max(hitMs, o.lateWindowMs ?? DEFAULT_LATE_WINDOW_MS),
  }
}

/** Consume as many observed events as possible against the sorted target. */
function consumeMatches(
  target: readonly TargetNote[],
  observed: readonly ObservedNote[],
  windows: MatchWindows,
): { matched: JudgedNote[]; extras: ObservedNote[]; consumed: Set<number> } {
  const order = observed
    .map((note, sequence) => ({ note, sequence }))
    .sort((a, b) => a.note.timeSec - b.note.timeSec || a.sequence - b.sequence)
  const matched: JudgedNote[] = []
  const consumed = new Set<number>()
  const extras: ObservedNote[] = []
  for (const { note: obs, sequence } of order) {
    // Earliest unconsumed target with the same pitch whose matchable window
    // contains the observed time. Per-note matching is order-agnostic, which
    // is why chords hit in any order and repeats pair with the next occurrence.
    let best: number = -1
    for (let i = 0; i < target.length; i += 1) {
      if (consumed.has(i)) continue
      const t = target[i]
      if (t.midi !== obs.midi) continue
      const openSec = t.startSec - windows.openMs / MS_PER_SEC
      const closeSec = t.startSec + windows.closeMs / MS_PER_SEC
      if (obs.timeSec >= openSec && obs.timeSec <= closeSec) {
        best = i
        break
      }
    }
    if (best < 0) {
      extras.push(obs)
      continue
    }
    consumed.add(best)
    const note = target[best]
    const deltaMs = (obs.timeSec - note.startSec) * MS_PER_SEC
    const near = Math.abs(deltaMs) <= windows.hitMs
    matched.push({
      note,
      state: deltaMs === 0 || near ? 'hit' : deltaMs < 0 ? 'early' : 'late',
      deltaMs,
      observedIndex: sequence,
    })
  }
  matched.sort((a, b) => a.note.startSec - b.note.startSec)
  return { matched, extras, consumed }
}

/**
 * Judge a full observed stream against the target.
 *
 * - Matched notes: `hit` (|delta| <= hitWindowMs), `early` (played before the
 *   tolerance, inside the early window) or `late` (after the tolerance, inside
 *   the late window).
 * - Unmatched observed notes: `extras` (a wrong note is therefore both a
 *   missing target note and an extra).
 * - Unmatched target notes: `missed` (window has passed; also the default for
 *   every unmatched note in a complete pass) or `pending` (`atSec` given and
 *   the note's matchable window still opens in the future).
 *
 * Chords: any strike order, at or near the target onset. Repeats: each
 * occurrence pairs with the earliest unconsumed target note of that pitch.
 * Polyphony: unrelated simultaneous notes do not interfere.
 */
export function matchEvents(
  target: readonly TargetNote[],
  observed: readonly ObservedNote[],
  options: MatchOptions = {},
): MatchResult {
  const windows = resolveWindows(options)
  const wantHand = options.hand ?? 'all'
  const usable = wantHand === 'all' ? target : target.filter((n) => n.hand === wantHand)
  const { matched, extras, consumed } = consumeMatches(usable, observed, windows)

  // Reference time for unmatched notes: the given position, or (offline) the
  // end of the piece, so "played nothing" is all `missed`, never all `pending`.
  let reference = options.atSec
  if (reference == null) {
    for (const note of usable) reference = Math.max(reference ?? 0, note.startSec)
  }
  const notes: JudgedNote[] = []
  for (let i = 0; i < usable.length; i += 1) {
    if (consumed.has(i)) continue
    const note = usable[i]
    const judged: JudgedNote = { note, state: 'missed' }
    if (
      reference != null &&
      note.startSec - windows.openMs / MS_PER_SEC > reference
    ) {
      judged.state = 'pending'
    }
    notes.push(judged)
  }
  notes.push(...matched)
  notes.sort((a, b) => a.note.startSec - b.note.startSec || a.note.midi - b.note.midi)
  return { notes, extras }
}

export interface WaitGateOptions extends MatchOptions {
  /** How far ahead of `positionSec` notes count as "due now". */
  lookaheadSec?: number
}

export interface WaitGateResult {
  /** Unplayed target notes due at or before `positionSec + lookaheadSec`. */
  outstanding: TargetNote[]
  /** True when nothing required is outstanding (the transport may advance). */
  mayAdvance: boolean
  /** Unique pitches of the outstanding notes, in onset order. */
  requiredPitches: number[]
}

/**
 * Which target notes the player still owes near this position, and whether the
 * transport may advance. Generalises the existing wait gate
 * (`Transport.waitPoints` + PlayerSurface's shared-onset wait points): the old
 * gate stopped at the next distinct onset and checked a single expected pitch;
 * this one requires every note of the chord (any order) and honours
 * hand/polyphony filtering through the same `MatchOptions`.
 */
export function waitGate(
  target: readonly TargetNote[],
  observed: readonly ObservedNote[],
  positionSec: number,
  options: WaitGateOptions = {},
): WaitGateResult {
  const lookahead = options.lookaheadSec ?? DEFAULT_WAIT_LOOKAHEAD_SEC
  const windows = resolveWindows(options)
  const wantHand = options.hand ?? 'all'
  const usable = wantHand === 'all' ? target : target.filter((n) => n.hand === wantHand)
  const { consumed } = consumeMatches(usable, observed, windows)
  const outstanding = usable.filter(
    (note, i) => !consumed.has(i) && note.startSec <= positionSec + lookahead,
  )
  const requiredPitches: number[] = []
  for (const note of outstanding) {
    if (!requiredPitches.includes(note.midi)) requiredPitches.push(note.midi)
  }
  return { outstanding, mayAdvance: outstanding.length === 0, requiredPitches }
}

/**
 * The next onset the player must satisfy for a pitch (or the first pending
 * note when `pitch` is null). Used by the DAW wait-gate caller, which knows
 * the transport is parked at that gate: "played now" == `timeSec` = this onset.
 * Unplayed notes either side of `afterSec` are skipped, so repeated notes
 * parade through as the gate advances.
 */
export function nextExpectedOnset(
  result: MatchResult,
  pitch: number | null,
  afterSec: number,
): number | null {
  let best: number | null = null
  for (const judged of result.notes) {
    if (judged.state !== 'pending' && judged.state !== 'missed') continue
    if (pitch != null && judged.note.midi !== pitch) continue
    if (judged.note.startSec < afterSec - 1e-6) continue
    if (best == null || judged.note.startSec < best) best = judged.note.startSec
  }
  return best
}

export interface MatchStats {
  /** Target notes judged (played or missed). Pending notes are excluded:
   * `pending` carries them separately, so the denominator of `accuracy` is
   * the notes actually judged for every caller. */
  total: number
  hit: number
  early: number
  late: number
  missed: number
  pending: number
  /** Extras recorded in this slice. */
  extra: number
  /** Strict accuracy: hit / total (0 when nothing is expected). */
  accuracy: number
}

export interface Section {
  index: number
  label: string
  startSec: number
  endSec: number
}

export interface ScoredSection {
  section: Section
  stats: MatchStats
}

export interface ScoreOptions {
  /** Sections to average over; default is one "All" section. */
  sections?: readonly Section[]
  /** Restrict reporting to one hand (defaults to all hands). */
  hand?: Hand
}

export interface ScoreResult {
  overall: MatchStats
  byHand: Partial<Record<Hand, MatchStats>>
  bySection: ScoredSection[]
  /** Worst sections first: lowest accuracy, then most missed notes. */
  practiceThese: ScoredSection[]
}

function emptyStats(): MatchStats {
  return { total: 0, hit: 0, early: 0, late: 0, missed: 0, pending: 0, extra: 0, accuracy: 0 }
}

/** Tally one judged note into a stats bucket. A pending note goes into its
 * own counter but never into `total`/`accuracy`: the denominator is the
 * notes actually judged, so a learner who stopped after 5 of 400 notes sees
 * "5 of 400" — not a sample-size-free 100%. */
function tally(stats: MatchStats, judged: JudgedNote): MatchStats {
  stats[judged.state] += 1
  if (judged.state !== 'pending') {
    stats.total += 1
    stats.accuracy = stats.total === 0 ? 0 : stats.hit / stats.total
  }
  return stats
}

/**
 * Score a match result: overall strict accuracy, per-hand, per-section, and a
 * ranked `practiceThese` list (worst section first) that seeds leg C's
 * "practise this bar" recommendation.
 *
 * `early`/`late` notes are played-but-imprecise: they surface in their own
 * counters and on the section stats; overall accuracy stays strict (`hit` only)
 * so a sloppy-but-complete pass cannot read as 100%.
 *
 * Pending notes are reported in `stats.pending` but never in a denominator:
 * an in-progress run with 1 hit and 395 pending notes reads 100% over a
 * sample of 1, which the summary must then disclose — not 100% over "396".
 */
export function score(result: MatchResult, options: ScoreOptions = {}): ScoreResult {
  const handFilter = options.hand
  const judged = handFilter ? result.notes.filter((j) => j.note.hand === handFilter) : result.notes

  const overall = emptyStats()
  for (const item of judged) tally(overall, item)
  overall.extra = result.extras.length

  const byHand: Partial<Record<Hand, MatchStats>> = {}
  for (const item of judged) {
    const key = item.note.hand
    const bucket = byHand[key] ?? emptyStats()
    byHand[key] = tally(bucket, item)
  }

  const endOfPiece = judged.reduce((max, j) => Math.max(max, j.note.startSec), 0)
  const sections: Section[] = options.sections?.length
    ? [...options.sections]
    : [{ index: 0, label: 'All', startSec: judged[0]?.note.startSec ?? 0, endSec: endOfPiece }]

  const bySection: ScoredSection[] = sections.map((section) => {
    const stats = emptyStats()
    for (const item of judged) {
      if (item.note.startSec < section.startSec || item.note.startSec >= section.endSec) continue
      tally(stats, item)
    }
    stats.extra = result.extras.filter(
      (extra) => extra.timeSec >= section.startSec && extra.timeSec < section.endSec,
    ).length
    return { section, stats }
  })

  const practiceThese = bySection
    // A section needs judged notes (pending-only sections are excluded) to
    // be worth practising; `total` already excludes pending notes.
    .filter((entry) => entry.stats.total > 0)
    .sort(
      (a, b) =>
        a.stats.accuracy - b.stats.accuracy ||
        b.stats.missed - a.stats.missed ||
        a.section.index - b.section.index,
    )

  return { overall, byHand, bySection, practiceThese }
}

/**
 * Sections from the existing marker model (`Marker { id, time, label }`,
 * frontend/src/player/markers.ts). Section i spans marker[i].time to
 * marker[i+1].time (last marker to the end of the target). With no markers and
 * a `bpm`, bars of `beats` beats (4/4 default); with neither, a single "All".
 */
export function sectionsFromMarkers(
  target: readonly TargetNote[],
  markers: readonly { time: number; label: string }[],
  options: { bpm?: number; beatsPerBar?: number } = {},
): Section[] {
  const start = target.length ? Math.min(...target.map((n) => n.startSec)) : 0
  const end = target.length ? Math.max(...target.map((n) => n.endSec)) : 0
  const sorted = [...markers].filter((m) => Number.isFinite(m.time)).sort((a, b) => a.time - b.time)
  const labelled = sorted.filter((m, i, list) => i === 0 || m.time > list[i - 1].time + 1e-6)
  if (labelled.length === 0) {
    const bpm = options.bpm
    if (bpm && bpm > 0) {
      const barSec = (60 / bpm) * Math.max(1, options.beatsPerBar ?? 4)
      const sections: Section[] = []
      for (let bar = 0, t = start; t < end - 1e-6; bar += 1, t += barSec) {
        sections.push({
          index: bar,
          label: `Bar ${bar + 1}`,
          startSec: t,
          endSec: Math.min(t + barSec, end),
        })
      }
      if (sections.length) return sections
    }
    return [{ index: 0, label: 'All', startSec: start, endSec: end }]
  }
  return labelled.map((marker, i) => ({
    index: i,
    label: marker.label,
    startSec: marker.time,
    endSec: i + 1 < labelled.length ? labelled[i + 1].time : Math.max(end, marker.time),
  }))
}
