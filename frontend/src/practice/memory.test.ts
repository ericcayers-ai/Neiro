import { describe, expect, it } from 'vitest'

import {
  BEATS_PER_BAR,
  MIN_OPACITY,
  SETTLE_EPSILON,
  barIndexOf,
  barPassesFromJudged,
  buildBarMemory,
  opacityForBar,
  opacityForMasteredPasses,
  recordPass,
  type BarPass,
  type PassHistory,
} from './memory'

const empty = (): PassHistory => ({ passes: [] })

describe('opacityForMasteredPasses', () => {
  it('leaves an unmastered bar fully opaque', () => {
    expect(opacityForMasteredPasses(0)).toBe(1)
  })

  it('fades strictly between passes, and each pass fades less than the one before', () => {
    const opacities = [0, 1, 2, 3, 4].map(opacityForMasteredPasses)
    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i]).toBeLessThan(opacities[i - 1])
    }
    const firstDrop = opacities[0] - opacities[1]
    const thirdDrop = opacities[2] - opacities[3]
    expect(thirdDrop).toBeLessThan(firstDrop)
  })

  it('never falls below the floor, however many passes are mastered', () => {
    expect(opacityForMasteredPasses(200)).toBeCloseTo(MIN_OPACITY, 6)
    expect(opacityForMasteredPasses(200)).toBeGreaterThanOrEqual(MIN_OPACITY)
  })

  it('is stable for negative or fractional input', () => {
    expect(opacityForMasteredPasses(-3)).toBe(1)
    expect(opacityForMasteredPasses(1.9)).toBe(opacityForMasteredPasses(1))
  })
})

describe('buildBarMemory', () => {
  const bars = [0, 1, 2, 3]

  it('an unplayed bar is fully opaque and says so', () => {
    const memory = buildBarMemory(empty(), bars)
    expect(memory).toHaveLength(4)
    for (const entry of memory) {
      expect(entry.opacity).toBe(1)
      expect(entry.passes).toBe(0)
      expect(entry.meanAccuracy).toBeNull()
      expect(entry.settled).toBe(false)
    }
  })

  it('a bar played badly stays opaque; a bar played well fades', () => {
    const history: PassHistory = {
      passes: [
        [
          { bar: 0, accuracy: 0.4, missed: 3 },
          { bar: 2, accuracy: 1, missed: 0 },
        ],
      ],
    }
    const memory = buildBarMemory(history, bars)
    const bad = memory.find((entry) => entry.bar === 0)!
    const good = memory.find((entry) => entry.bar === 2)!
    expect(bad.opacity).toBe(1)
    expect(bad.masteredPasses).toBe(0)
    expect(good.opacity).toBeLessThan(1)
    expect(good.masteredPasses).toBe(1)
  })

  it('the leg-D claim: the same bar fades between passes', () => {
    let history = empty()
    history = recordPass(history, [{ bar: 1, accuracy: 0.95 }])
    const afterOne = buildBarMemory(history, bars).find((entry) => entry.bar === 1)!
    history = recordPass(history, [{ bar: 1, accuracy: 0.98 }])
    const afterTwo = buildBarMemory(history, bars).find((entry) => entry.bar === 1)!
    expect(afterTwo.opacity).toBeLessThan(afterOne.opacity)
    expect(afterTwo.masteredPasses).toBe(2)
  })

  it('counts a pass once per bar even when the pass reports the bar twice, taking the best reading', () => {
    const history: PassHistory = {
      passes: [[{ bar: 1, accuracy: 0.2 }, { bar: 1, accuracy: 0.95 }]],
    }
    const entry = buildBarMemory(history, bars).find((candidate) => candidate.bar === 1)!
    expect(entry.passes).toBe(1)
    expect(entry.masteredPasses).toBe(1)
    expect(entry.meanAccuracy).toBeCloseTo(0.95, 6)
  })

  it('ignores bars the caller did not ask about, and clamps out-of-range accuracy', () => {
    const history: PassHistory = {
      passes: [
        [
          { bar: 99, accuracy: 1 },
          { bar: 3, accuracy: 5 },
        ],
      ],
    }
    const memory = buildBarMemory(history, bars)
    expect(memory.map((entry) => entry.bar)).toEqual([0, 1, 2, 3])
    const bar3 = memory.find((entry) => entry.bar === 3)!
    expect(bar3.meanAccuracy).toBe(1)
    expect(bar3.masteredPasses).toBe(1)
  })

  it('a bar settles at the floor after enough clean passes', () => {
    let history = empty()
    for (let pass = 0; pass < 12; pass += 1) {
      history = recordPass(history, [{ bar: 0, accuracy: 1 }])
    }
    const entry = buildBarMemory(history, bars).find((candidate) => candidate.bar === 0)!
    expect(entry.settled).toBe(true)
    // The fade is geometric, so it approaches the floor without reaching it: assert the documented
    // epsilon (SETTLE_EPSILON) rather than exact equality, which the curve can never produce.
    expect(entry.opacity).toBeGreaterThanOrEqual(MIN_OPACITY)
    expect(entry.opacity - MIN_OPACITY).toBeLessThanOrEqual(SETTLE_EPSILON)
  })
})

describe('opacityForBar', () => {
  it('reads the bar it was asked for', () => {
    const history = recordPass(empty(), [{ bar: 2, accuracy: 1 }])
    const memory = buildBarMemory(history, [0, 1, 2])
    expect(opacityForBar(memory, 2)).toBeLessThan(1)
    expect(opacityForBar(memory, 0)).toBe(1)
  })

  it('treats a bar outside the map as unplayed rather than hiding it', () => {
    const memory = buildBarMemory(empty(), [0])
    expect(opacityForBar(memory, 42)).toBe(1)
  })
})

describe('barIndexOf (the app 4/4 bar convention)', () => {
  it('counts bars at the beat rate the tempo implies', () => {
    expect(BEATS_PER_BAR).toBe(4)
    // 120 bpm => 0.5 s per beat => 2 s per 4/4 bar.
    expect(barIndexOf(0, 120)).toBe(0)
    expect(barIndexOf(1.99, 120)).toBe(0)
    expect(barIndexOf(2, 120)).toBe(1)
    expect(barIndexOf(5.5, 120)).toBe(2)
    expect(barIndexOf(0, 60)).toBe(0)
    expect(barIndexOf(4, 60)).toBe(1)
  })

  it('returns bar 0 rather than NaN when the tempo is unusable', () => {
    for (const bpm of [0, -120, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(barIndexOf(10, bpm)).toBe(0)
    }
    expect(barIndexOf(Number.NaN, 120)).toBe(0)
    expect(barIndexOf(-5, 120)).toBe(0)
  })
})

describe('barPassesFromJudged', () => {
  const judged = (state: string, startSec: number) => ({ state, note: { startSec } })

  it('groups a run into per-bar accuracy and excludes pending notes', () => {
    // 120 bpm: bar 0 is 0..2 s, bar 1 is 2..4 s.
    const passes = barPassesFromJudged(
      [
        judged('hit', 0.2),
        judged('hit', 1.0),
        judged('missed', 1.5),
        judged('pending', 1.9),
        judged('hit', 2.5),
        judged('late', 3.0),
      ],
      120,
    )
    expect(passes.map((entry) => entry.bar)).toEqual([0, 1])
    // bar 0: 2 hits of 3 judged (pending excluded); bar 1: 1 of 2.
    expect(passes[0].accuracy).toBeCloseTo(2 / 3, 6)
    expect(passes[0].missed).toBe(1)
    expect(passes[1].accuracy).toBeCloseTo(1 / 2, 6)
    expect(passes[1].missed).toBe(1)
  })

  it('is sorted by bar and returns nothing for an all-pending run', () => {
    const unordered = barPassesFromJudged([judged('hit', 5.0), judged('hit', 0.1)], 120)
    expect(unordered.map((entry) => entry.bar)).toEqual([0, 2])
    expect(barPassesFromJudged([judged('pending', 1), judged('pending', 3)], 120)).toEqual([])
  })

  it('feeds buildBarMemory: one clean run fades the bar it covered', () => {
    const history = recordPass(empty(), barPassesFromJudged([judged('hit', 0.5), judged('hit', 1.0)], 120))
    const memory = buildBarMemory(history, [0, 1])
    expect(memory.find((entry) => entry.bar === 0)!.opacity).toBeLessThan(1)
    expect(memory.find((entry) => entry.bar === 1)!.opacity).toBe(1)
  })
})

describe('recordPass', () => {
  it('appends without mutating the history it was given', () => {
    const history = empty()
    const pass: BarPass[] = [{ bar: 0, accuracy: 0.5 }]
    const next = recordPass(history, pass)
    expect(history.passes).toHaveLength(0)
    expect(next.passes).toHaveLength(1)
    pass[0].accuracy = 1
    expect(next.passes[0][0].accuracy).toBe(0.5)
  })
})
