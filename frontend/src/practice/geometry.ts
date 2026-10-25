/**
 * Practice roll geometry — the pure, DOM-free half of the falling-note view
 * (PianoVision adoption leg B).
 *
 * No canvas, no `window`, no timers: every function here is (input) -> (numbers
 * or plain objects), so the maths is unit-testable in Node and the canvas
 * component (`PianoRoll.tsx`) only does measuring and drawing.
 *
 * Coordinates: the roll scrolls right-to-left — a target note exactly at the
 * transport time `now` sits with its left edge on the judgement line, future
 * notes are to the right of it and fall left as `now` advances (one clock: the
 * repo's transport, fed in as `now`). The pitch axis runs top-down, high notes
 * on top, one lane per semitone.
 */

import type { Hand, JudgedNote, NoteState } from './engine'

/** Default pitch range: A0 (MIDI 21) .. C8 (MIDI 108) — the full piano. */
export const DEFAULT_PITCH_LOW = 21
export const DEFAULT_PITCH_HIGH = 108
/** Default horizontal gap drawn between adjacent pitch lanes, in CSS px. */
export const DEFAULT_LANE_GAP_PX = 2
/** A note at least this wide, so is played staccato notes stay visible. */
export const MIN_NOTE_WIDTH_PX = 2
/** Default horizontal speed of the roll, in CSS px per transport second. */
export const DEFAULT_PIXELS_PER_SECOND = 120

/** Clamp 0..127: MIDI note numbers never exceed this convention. */
const clampMidi = (value: number): number => Math.min(127, Math.max(0, Math.round(value)))

/** Per-semitone lane height derived from the pitch range and canvas height. */
export function laneHeight(options: { low: number; high: number; height: number }): number {
  const low = clampMidi(options.low)
  const high = clampMidi(options.high)
  const lanes = Math.max(1, high - low + 1)
  return options.height / lanes
}

/**
 * Transport time -> x. A note whose onset equals `now` lands exactly on the
 * judgement line; future times fall to the right, past times to the left.
 */
export function timeToX(
  t: number,
  pixels: { now: number; pixelsPerSecond: number; judgementX: number },
): number {
  return pixels.judgementX + (t - pixels.now) * pixels.pixelsPerSecond
}

/**
 * MIDI pitch -> y of the top of its lane. Out-of-range pitches clamp into the
 * nearest lane (below the lowest note, above the highest note), so a target
 * that creeps past the configured piano range still draws inside the canvas
 * instead of disappearing.
 */
export function pitchToY(
  pitch: number,
  pixels: { low: number; high: number; height: number },
): number {
  const low = clampMidi(pixels.low)
  const high = clampMidi(pixels.high)
  const clamped = Math.min(high, Math.max(low, clampMidi(pitch)))
  return (high - clamped) * laneHeight({ low, high, height: pixels.height })
}

/** Fully resolved layout used by `noteRect` and the canvas draw. */
export interface RollLayout {
  /** Transport position (seconds) the roll is drawn at. */
  now: number
  pixelsPerSecond: number
  /** x of the judgement line, in CSS px. */
  judgementX: number
  low: number
  high: number
  /** Canvas height in CSS px. */
  height: number
  /** Effective gap between lanes (may be smaller than requested, see below). */
  laneGap: number
  laneHeight: number
  noteHeight: number
}

export interface RollLayoutOptions {
  now?: number
  pixelsPerSecond?: number
  judgementX: number
  low?: number
  high?: number
  height: number
  laneGap?: number
}

/**
 * Resolve defaults (A0..C8, 120 px/s, 2 px lane gap) into a `RollLayout`.
 *
 * Documented lane-gap rule: the effective gap never exceeds a quarter of the
 * lane height, so a narrow pitch range (e.g. a scale) keeps full-height notes
 * with thin gaps instead of collapsing into invisible slivers.
 */
export function rollLayout(options: RollLayoutOptions): RollLayout {
  const low = clampMidi(options.low ?? DEFAULT_PITCH_LOW)
  const high = Math.max(low, clampMidi(options.high ?? DEFAULT_PITCH_HIGH))
  const lane = laneHeight({ low, high, height: options.height })
  const requestedGap = options.laneGap ?? DEFAULT_LANE_GAP_PX
  const laneGap = Math.max(0, Math.min(requestedGap, lane / 4))
  return {
    now: options.now ?? 0,
    pixelsPerSecond: options.pixelsPerSecond ?? DEFAULT_PIXELS_PER_SECOND,
    judgementX: options.judgementX,
    low,
    high,
    height: options.height,
    laneGap,
    laneHeight: lane,
    noteHeight: Math.max(1, lane - laneGap),
  }
}

/**
 * Target notes whose bar overlaps the horizontal window
 * `[fromSec, toSec]` (transport-time seconds). Order preserved.
 */
export function visibleNotes<T extends JudgedNote>(
  notes: readonly T[],
  window: { fromSec: number; toSec: number },
): T[] {
  return notes.filter(
    (judged) =>
      Number.isFinite(judged.note.startSec) &&
      judged.note.endSec >= window.fromSec &&
      judged.note.startSec <= window.toSec,
  )
}

/** One drawable rectangle for one judged note, in CSS px. */
export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
  hand: Hand
  state: NoteState
}

export function noteRect(judged: JudgedNote, layout: RollLayout): NoteRect {
  const start = judged.note.startSec
  const durationPx = (judged.note.endSec - start) * layout.pixelsPerSecond
  return {
    x: timeToX(start, layout),
    y: pitchToY(judged.note.midi, layout),
    w: Math.max(MIN_NOTE_WIDTH_PX, durationPx),
    h: layout.noteHeight,
    hand: judged.note.hand,
    state: judged.state,
  }
}

/** Hand hues: two colour-blind-distinguishable hues plus a neutral. Left =
 * sky blue, right = amber, unknown = slate. Chosen for contrast on the
 * app's dark player surface. */
export const HAND_COLOURS: Record<Hand, string> = {
  left: '#38bdf8',
  right: '#fbbf24',
  unknown: '#94a3b8',
}

/** Neutral single hue when `showHands` is off. */
export const NEUTRAL_COLOUR = '#5eead4'

/**
 * How a state paints (the colour-blind-safe half of the encoding: the hue says
 * which hand, the fill/outline says the state — a hollow outline is missed, a
 * dim fill is pending, a bright fill is a hit, and an off-time hit gets an
 * outline on top of the fill).
 */
export interface NotePaint {
  /** Canvas fill alpha (0 = no fill drawn). */
  fillAlpha: number
  /** Outline width in px (0 = no outline drawn). */
  strokeWidth: number
}

export function notePaint(state: NoteState): NotePaint {
  switch (state) {
    case 'pending':
      return { fillAlpha: 0.45, strokeWidth: 0 }
    case 'hit':
      return { fillAlpha: 1, strokeWidth: 0 }
    case 'early':
    case 'late':
      return { fillAlpha: 0.55, strokeWidth: 2 }
    case 'missed':
      return { fillAlpha: 0, strokeWidth: 2 }
  }
}
