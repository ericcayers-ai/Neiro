import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANE_GAP_PX,
  DEFAULT_PITCH_HIGH,
  DEFAULT_PITCH_LOW,
  MIN_NOTE_WIDTH_PX,
  HAND_COLOURS,
  NEUTRAL_COLOUR,
  notePaint,
  noteRect,
  pitchToY,
  rollLayout,
  timeToX,
  laneHeight,
  visibleNotes,
} from './geometry'
import { matchEvents, parseTarget, type JudgedNote, type RawTargetEvent } from './engine'

/** Named falsification target: this test breaks if the fall direction of the
 * roll is inverted (notes must fall LEFT toward the judgement line, so a
 * future note is to the RIGHT of it, and a note at `now` sits exactly on it). */
describe('timeToX', () => {
  const pixels = { now: 10, pixelsPerSecond: 100, judgementX: 200 }

  it('falls forward: a note at the transport time sits exactly on the judgement line', () => {
    expect(timeToX(10, pixels)).toBe(200)
  })

  it('puts a future note to the right, by pixelsPerSecond', () => {
    expect(timeToX(11, pixels)).toBe(300)
  })

  it('puts a past note to the left of the judgement line', () => {
    expect(timeToX(9.5, pixels)).toBe(150)
  })
})

describe('pitchToY', () => {
  const pixels = { low: 60, high: 71, height: 120 }

  it('puts the highest pitch at the top (y=0) and one lane per semitone below it', () => {
    expect(pitchToY(71, pixels)).toBe(0)
    expect(pitchToY(70, pixels)).toBe(10)
    expect(pitchToY(60, pixels)).toBe(110)
  })

  it('matches laneHeight across the range bottom', () => {
    expect(laneHeight(pixels)).toBe(10)
  })

  it('clamps out-of-range pitches into the nearest lane instead of leaving the canvas', () => {
    expect(pitchToY(5000, pixels)).toBe(0)
    expect(pitchToY(-5, pixels)).toBe(110)
  })
})

describe('rollLayout defaults', () => {
  it('defaults to the full piano A0..C8 and resolves the documented lane gap', () => {
    const layout = rollLayout({ judgementX: 50, height: 1000 })
    expect(layout.low).toBe(DEFAULT_PITCH_LOW)
    expect(layout.high).toBe(DEFAULT_PITCH_HIGH)
    expect(layout.pixelsPerSecond).toBe(120)
    expect(layout.laneGap).toBe(DEFAULT_LANE_GAP_PX)
    // 88 lanes over 1000 px.
    expect(layout.laneHeight).toBeCloseTo(1000 / 88, 10)
    expect(layout.noteHeight).toBeCloseTo(1000 / 88 - DEFAULT_LANE_GAP_PX, 10)
  })

  it('shrinks the lane gap so it never exceeds a quarter of the lane height', () => {
    const layout = rollLayout({ judgementX: 50, height: 176, laneGap: 10 })
    expect(layout.laneHeight).toBe(2)
    expect(layout.laneGap).toBe(0.5)
    expect(layout.noteHeight).toBe(1.5)
  })

  it('keeps the default gap when lanes are tall enough for it', () => {
    const layout = rollLayout({ judgementX: 50, height: 1000 })
    expect(layout.laneHeight).toBeGreaterThan(8)
    expect(layout.laneGap).toBe(DEFAULT_LANE_GAP_PX)
  })
})

function judgedFor(
  tracks: Record<string, RawTargetEvent[]>,
  observedTimes: number[] = [],
  atSec?: number,
): JudgedNote[] {
  const target = parseTarget(tracks)
  return matchEvents(
    target,
    observedTimes.map((timeSec) => ({ timeSec, midi: 60 })),
    atSec == null ? {} : { atSec },
  ).notes
}

const now = 20
const baseLayout = rollLayout({ now, pixelsPerSecond: 100, judgementX: 200, height: 100 })

describe('visibleNotes', () => {
  it('keeps notes that overlap the window and drops the rest, preserving order', () => {
    const notes = judgedFor({
      a: [
        { onset: 10, offset: 11, pitch: 60, velocity: 80 }, // ended before the window
        { onset: 19.5, offset: 20.5, pitch: 60, velocity: 80 }, // straddles `now`
        { onset: 22, offset: 23, pitch: 60, velocity: 80 }, // starts inside the window
        { onset: 26, offset: 27, pitch: 60, velocity: 80 }, // entirely after
      ],
    })
    const visible = visibleNotes(notes, { fromSec: now, toSec: now + 4 })
    expect(visible).toHaveLength(2)
    expect(visible[0].note.startSec).toBe(19.5)
    expect(visible[1].note.startSec).toBe(22)
  })

  it('keeps a note whose onset is exactly on a window edge', () => {
    const notes = judgedFor({ a: [{ onset: now, offset: 21, pitch: 60, velocity: 80 }] })
    expect(visibleNotes(notes, { fromSec: now, toSec: now + 4 })).toHaveLength(1)
  })
})

describe('noteRect', () => {
  const track = (onset: number, offset: number): Record<string, RawTargetEvent[]> => ({
    a: [{ onset, offset, pitch: 60, velocity: 80, channel: 1 }],
  })

  it('hit: filled, left edge on the judgement line when played at the transport time', () => {
    const [hit] = judgedFor(track(now, now + 1), [now])
    const rect = noteRect(hit, baseLayout)
    expect(rect).toMatchObject({ x: 200, w: 100, y: expect.any(Number), h: baseLayout.noteHeight })
    expect(rect.state).toBe('hit')
    expect(rect.hand).toBe('left')
  })

  it('pending: dim fill, rect sits to the right of the judgement line', () => {
    // With the live-position reference (`atSec`), an unplayed note whose
    // matchable window still opens in the future stays `pending`.
    const [pending] = judgedFor(track(now + 2, now + 3), [], now)
    const rect = noteRect(pending, baseLayout)
    expect(rect.x).toBe(400)
    expect(rect.w).toBe(100)
    expect(rect.state).toBe('pending')
    expect(notePaint('pending').fillAlpha).toBeLessThan(1)
    expect(notePaint('pending').strokeWidth).toBe(0)
  })

  it('missed: hollow (outline only), rect already to the left of the judgement line', () => {
    const notes = judgedFor(track(now - 2, now - 1))
    const missed = notes.find((n) => n.state === 'missed')
    expect(missed).toBeDefined()
    const rect = noteRect(missed!, baseLayout)
    expect(rect.x).toBe(0)
    expect(rect.state).toBe('missed')
    expect(notePaint('missed').fillAlpha).toBe(0)
    expect(notePaint('missed').strokeWidth).toBeGreaterThan(0)
  })

  it('early and late: outline on top of the fill', () => {
    const withEarly = judgedFor(track(now + 0.9, now + 1.9), [now + 0.7]) // 200ms before at 300ms window
    const withLate = judgedFor(track(now + 0.5, now + 1.5), [now + 1.0]) // 500ms after at 500ms window
    expect(withEarly.find((n) => n.state === 'early')).toBeDefined()
    expect(withLate.find((n) => n.state === 'late')).toBeDefined()
    for (const state of ['early', 'late'] as const) {
      expect(notePaint(state).strokeWidth).toBe(2)
      expect(notePaint(state).fillAlpha).toBeGreaterThan(0)
    }
  })

  it('never returns a zero-width rect (MIN_NOTE_WIDTH_PX)', () => {
    const [note] = judgedFor(track(now + 2, now + 2.001))
    expect(noteRect(note, { ...baseLayout, pixelsPerSecond: 1000 }).w).toBeGreaterThanOrEqual(
      MIN_NOTE_WIDTH_PX,
    )
  })

  it('uses distinguishable hand colours on the dark surface', () => {
    expect(new Set(Object.values(HAND_COLOURS)).size).toBe(3)
    expect(HAND_COLOURS.left).not.toBe(HAND_COLOURS.right)
    expect(typeof NEUTRAL_COLOUR).toBe('string')
  })

  it('gives every state a distinct paint encoding (hue is not the only signal)', () => {
    const paints = (['pending', 'hit', 'early', 'late', 'missed'] as const).map(notePaint)
    // pending 0.45/no-outline, hit 1/no-outline, early+late shared
    // fill-with-outline, missed hollow-outline-only: 4 encodings, all
    // distinguishable without reading the hue.
    expect(new Set(paints.map((p) => `${p.fillAlpha}:${p.strokeWidth}`)).size).toBe(4)
  })
})
