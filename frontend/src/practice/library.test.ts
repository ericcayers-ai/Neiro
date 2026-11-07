import { describe, expect, it } from 'vitest'

import {
  DIFFICULTY_BANDS,
  describeTarget,
  difficultyForDensity,
  maxSimultaneousNotes,
  targetEndSec,
  whyTooSmallToPractise,
  type LibraryTarget,
} from './library'

/** A scale-like line: one note every 0.5 s for 4 s, 8 notes, monophonic. */
function scale(): LibraryTarget {
  return {
    melody: Array.from({ length: 8 }, (_, index) => ({
      onset: index * 0.5,
      offset: index * 0.5 + 0.45,
      pitch: 60 + index,
      velocity: 80,
    })),
  }
}

describe('difficultyForDensity', () => {
  it('maps the documented thresholds to bands', () => {
    expect(difficultyForDensity(0)).toBe(1)
    expect(difficultyForDensity(0.5)).toBe(1)
    expect(difficultyForDensity(1.5)).toBe(2)
    expect(difficultyForDensity(3)).toBe(3)
    expect(difficultyForDensity(6)).toBe(4)
    expect(difficultyForDensity(20)).toBe(5)
  })

  it('never leaves the 1..5 range, whatever it is fed', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -5, 1e9]) {
      const band = difficultyForDensity(value)
      expect(band).toBeGreaterThanOrEqual(1)
      expect(band).toBeLessThanOrEqual(5)
    }
  })

  it('names the band the number refers to', () => {
    expect(DIFFICULTY_BANDS[difficultyForDensity(2.5) - 1]).toBe('moderate')
  })
})

describe('maxSimultaneousNotes', () => {
  it('is 1 for a monophonic line', () => {
    expect(maxSimultaneousNotes(scale())).toBe(1)
  })

  it('counts a four-note chord as 4', () => {
    const chord: LibraryTarget = {
      harmony: [
        { onset: 0, offset: 1, pitch: 60 },
        { onset: 0, offset: 1, pitch: 64 },
        { onset: 0, offset: 1, pitch: 67 },
        { onset: 0, offset: 1, pitch: 71 },
      ],
    }
    expect(maxSimultaneousNotes(chord)).toBe(4)
  })

  it('does not count a note that ends exactly when the next begins', () => {
    const legato: LibraryTarget = {
      line: [
        { onset: 0, offset: 1, pitch: 60 },
        { onset: 1, offset: 2, pitch: 62 },
      ],
    }
    expect(maxSimultaneousNotes(legato)).toBe(1)
  })

  it('handles a note with no offset without inflating the peak', () => {
    const open: LibraryTarget = {
      line: [
        { onset: 0, pitch: 60 },
        { onset: 1, offset: 2, pitch: 62 },
      ],
    }
    expect(maxSimultaneousNotes(open)).toBeLessThanOrEqual(2)
    expect(maxSimultaneousNotes({})).toBe(0)
  })
})

describe('describeTarget', () => {
  it('describes a real line: duration, density, band, channels, range', () => {
    const descriptor = describeTarget(scale())
    expect(descriptor.noteCount).toBe(8)
    expect(descriptor.durationSec).toBeCloseTo(3.95, 6)
    expect(descriptor.notesPerSecond).toBeCloseTo(8 / 3.95, 6)
    expect(descriptor.difficulty).toBe(3)
    expect(descriptor.difficultyLabel).toBe('moderate')
    expect(descriptor.channels).toEqual(['melody'])
    expect(descriptor.hasPercussion).toBe(false)
    expect(descriptor.pitchRange).toEqual({ low: 60, high: 67 })
    expect(descriptor.onsetCount).toBe(8)
    expect(descriptor.maxSimultaneous).toBe(1)
  })

  it('marks percussion using the importer convention', () => {
    const target: LibraryTarget = {
      piano: [{ onset: 0, offset: 1, pitch: 60 }],
      'kit.drums': [{ onset: 0, offset: 0.2, pitch: 36 }],
    }
    const descriptor = describeTarget(target)
    expect(descriptor.hasPercussion).toBe(true)
    expect(descriptor.channels).toEqual(['piano', 'kit.drums'])
  })

  it('an empty target describes itself honestly instead of dividing by zero', () => {
    const descriptor = describeTarget({})
    expect(descriptor.noteCount).toBe(0)
    expect(descriptor.durationSec).toBe(0)
    expect(descriptor.notesPerSecond).toBe(0)
    expect(descriptor.difficulty).toBe(1)
    expect(descriptor.pitchRange).toBeNull()
    expect(descriptor.maxSimultaneous).toBe(0)
    expect(descriptor.channels).toEqual([])
  })

  it('ignores malformed entries rather than throwing', () => {
    const target = {
      weird: [{ onset: 0, pitch: 60 }, { onset: Number.NaN, pitch: 62 }, null as never],
    } as LibraryTarget
    const descriptor = describeTarget(target)
    expect(descriptor.noteCount).toBe(1)
  })
})

describe('targetEndSec', () => {
  it('is the absolute end of the target, not the span between first and last onset', () => {
    // A target whose first note is at 5 s: the transport must run to 6.5 s, not to 1.5 s.
    const late: LibraryTarget = {
      melody: [
        { onset: 5, offset: 5.5, pitch: 60 },
        { onset: 6, offset: 6.5, pitch: 62 },
      ],
    }
    expect(describeTarget(late).durationSec).toBeCloseTo(1.5, 5)
    expect(targetEndSec(late)).toBeCloseTo(6.5, 5)
  })

  it('falls back to the onset when a note carries no offset, and is 0 when empty', () => {
    expect(targetEndSec({ melody: [{ onset: 2, pitch: 60 }] })).toBeCloseTo(2, 5)
    expect(targetEndSec({})).toBe(0)
  })

  it('agrees with the descriptor for a target that starts at 0', () => {
    expect(targetEndSec(scale())).toBeCloseTo(describeTarget(scale()).durationSec, 5)
  })
})

describe('whyTooSmallToPractise', () => {
  it('names the reason rather than showing an empty card', () => {
    expect(whyTooSmallToPractise(describeTarget({}))).toBe('this file carries no notes')
    const three: LibraryTarget = {
      line: [
        { onset: 0, offset: 0.5, pitch: 60 },
        { onset: 0.5, offset: 1, pitch: 62 },
        { onset: 1, offset: 1.5, pitch: 64 },
      ],
    }
    expect(whyTooSmallToPractise(describeTarget(three))).toMatch(/only 3 notes/)
  })

  it('passes a real piece through', () => {
    expect(whyTooSmallToPractise(describeTarget(scale()))).toBeNull()
  })
})
