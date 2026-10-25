import { describe, expect, it } from 'vitest'
import {
  matchEvents,
  nextExpectedOnset,
  parseTarget,
  score,
  sectionsFromMarkers,
  waitGate,
  type ObservedNote,
  type RawTargetEvent,
} from './engine'

/** Build a track shaped exactly like `TranscribeResult.tracks` values. */
function midiEvent(onset: number, pitch: number, offset = onset + 0.5, velocity = 80): RawTargetEvent {
  return { onset, offset, pitch, velocity, confidence: 1.0 }
}

const note = (timeSec: number, midi: number): ObservedNote => ({ timeSec, midi, velocity: 90 })

describe('parseTarget', () => {
  it('maps the real TranscribeResult.tracks shape onto startSec/endSec/midi/velocity', () => {
    const target = parseTarget({
      piano: [midiEvent(1.0, 60, 1.8, 95)],
      'piano.drums': [midiEvent(2.0, 42)],
    })
    expect(target).toHaveLength(2)
    expect(target[0]).toMatchObject({
      startSec: 1.0,
      endSec: 1.8,
      midi: 60,
      velocity: 95,
      track: 'piano',
    })
    expect(target[1].track).toBe('piano.drums')
  })

  it('derives hands from MIDI channel (left=1, right=0) and unknown otherwise', () => {
    const target = parseTarget({
      a: [{ onset: 0, offset: 1, pitch: 60, velocity: 80, channel: 1 }],
      b: [{ onset: 1, offset: 2, pitch: 67, velocity: 80, channel: 0 }],
      c: [midiEvent(2, 72)], // frontend MidiEvent carries no channel
    })
    expect(target[0].hand).toBe('left')
    expect(target[1].hand).toBe('right')
    expect(target[2].hand).toBe('unknown')
  })

  it('honours the handByTrack / handByChannel overrides over the defaults', () => {
    const target = parseTarget(
      {
        'treble-clef': [midiEvent(0, 60)],
        'bass-clef': [midiEvent(0, 36)],
      },
      { handByTrack: { 'treble-clef': 'right', 'bass-clef': 'left' } },
    )
    // Sorted by onset then pitch, so bass (36) comes first at the shared onset.
    expect(target.map((t) => t.hand)).toEqual(['left', 'right'])
  })

  it('returns notes in onset order regardless of track order', () => {
    const target = parseTarget({
      late: [midiEvent(5, 60)],
      early: [midiEvent(0.5, 64)],
    })
    expect(target.map((t) => t.startSec)).toEqual([0.5, 5])
    expect(target.map((t) => t.index)).toEqual([0, 1])
  })
})

describe('matchEvents', () => {
  const solo = parseTarget({ piano: [midiEvent(1.0, 60)] })

  it('judges an exact hit with deltaMs', () => {
    const result = matchEvents(solo, [note(1.0, 60)])
    expect(result.extras).toHaveLength(0)
    expect(result.notes[0].state).toBe('hit')
    expect(result.notes[0].deltaMs).toBeCloseTo(0, 6)
  })

  it('judges an early played note inside the early window as early', () => {
    const result = matchEvents(solo, [note(0.8, 60)]) // 200 ms early, tolerance 150 ms
    expect(result.notes[0].state).toBe('early')
    expect(result.notes[0].deltaMs).toBeCloseTo(-200, 6)
  })

  it('judges a late played note inside the late window as late', () => {
    const result = matchEvents(solo, [note(1.25, 60)]) // 250 ms late
    expect(result.notes[0].state).toBe('late')
    expect(result.notes[0].deltaMs).toBeCloseTo(250, 6)
  })

  it('judges a note never played (empty observed stream) as missed', () => {
    const result = matchEvents(solo, [])
    expect(result.notes[0].state).toBe('missed')
    expect(result.extras).toHaveLength(0)
  })

  it('marks a wrong note both as a missed target note and an extra', () => {
    const result = matchEvents(solo, [note(1.0, 61)])
    expect(result.notes[0].state).toBe('missed')
    expect(result.extras).toEqual([{ timeSec: 1.0, midi: 61, velocity: 90 }])
  })

  it('matches a 3-note chord struck in reverse order (order-agnostic)', () => {
    const chord = parseTarget({
      piano: [midiEvent(1.0, 60), midiEvent(1.0, 64), midiEvent(1.0, 67)],
    })
    const result = matchEvents(chord, [note(1.0, 67), note(1.0, 64), note(1.0, 60)])
    expect(result.notes.map((j) => j.state)).toEqual(['hit', 'hit', 'hit'])
    expect(result.extras).toHaveLength(0)
  })

  it('leaves a repeated target note missed when it was played only once', () => {
    const repeat = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.0, 60)] })
    const result = matchEvents(repeat, [note(1.0, 60)])
    expect(result.notes[0].state).toBe('hit')
    expect(result.notes[1].state).toBe('missed')
  })

  it('pairs each strike with its own occurrence when a repeat is played twice', () => {
    const repeat = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.0, 60)] })
    const result = matchEvents(repeat, [note(1.0, 60), note(2.05, 60)])
    expect(result.notes.map((j) => j.state)).toEqual(['hit', 'hit'])
    expect(result.notes[1].deltaMs).toBeCloseTo(50, 6)
  })

  it('handles polyphony across two hands without interference', () => {
    const both = parseTarget({
      'hand.left': [midiEvent(1.0, 36)],
      'hand.right': [midiEvent(1.0, 67)],
    })
    const result = matchEvents(both, [note(1.02, 67), note(0.95, 36)])
    expect(result.notes.map((j) => j.state)).toEqual(['hit', 'hit'])
  })

  it('filters by hand so only the practising hand is judged', () => {
    const both = parseTarget({
      'hand.left': [midiEvent(1.0, 36)],
      'hand.right': [midiEvent(1.0, 67)],
    })
    const result = matchEvents(both, [note(1.0, 67)], { hand: 'right' })
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].note.midi).toBe(67)
    expect(result.notes[0].state).toBe('hit')
  })

  it('reports pending for future notes when atSec is given (live run)', () => {
    const run = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.5, 64)] })
    const result = matchEvents(run, [note(1.0, 60)], { atSec: 1.2 })
    expect(result.notes[0].state).toBe('hit')
    expect(result.notes[1].state).toBe('pending')
  })

  it('keeps a window already opened (unplayed) as missed, a future one as pending', () => {
    const target = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(1.5, 64)] })
    const result = matchEvents(target, [], { atSec: 1.1 })
    expect(result.notes[0].state).toBe('missed')
    expect(result.notes[1].state).toBe('pending')
  })
})

describe('waitGate', () => {
  const gate = parseTarget({
    'hand.left': [midiEvent(1.0, 60)],
    'hand.right': [midiEvent(1.0, 64), midiEvent(2.0, 60)],
  })

  it('blocks before the required chord is played and reports its pitches', () => {
    const state = waitGate(gate, [], 1.0, { lookaheadSec: 0.5 })
    expect(state.mayAdvance).toBe(false)
    expect(state.outstanding).toHaveLength(2)
    expect(state.requiredPitches).toEqual([60, 64])
  })

  it('advances once every note the gate asks for was played (any order)', () => {
    const played = [note(0.98, 64), note(1.05, 60)]
    const advanced = waitGate(gate, played, 1.2, { lookaheadSec: 0.5 })
    expect(advanced.mayAdvance).toBe(true)
    expect(advanced.requiredPitches).toEqual([])
  })

  it('re-arms for the next onset after advancing', () => {
    const played = [note(1.0, 64), note(1.02, 60)]
    const again = waitGate(gate, played, 2.4, { lookaheadSec: 0.5 })
    expect(again.mayAdvance).toBe(false)
    expect(again.requiredPitches).toEqual([60])
    const freed = waitGate(gate, [...played, note(2.0, 60)], 2.4, { lookaheadSec: 0.5 })
    expect(freed.mayAdvance).toBe(true)
    expect(freed.outstanding).toHaveLength(0)
  })
})

describe('nextExpectedOnset', () => {
  it('walks repeated pitches forward as the gate moves', () => {
    const target = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.0, 60)] })
    const first = nextExpectedOnset(matchEvents(target, []), 60, 0)
    expect(first).toBe(1.0)
    const second = nextExpectedOnset(matchEvents(target, [note(1.0, 60)]), 60, 1.0)
    expect(second).toBe(2.0)
  })

  it('returns null when that pitch is fully satisfied', () => {
    const target = parseTarget({ piano: [midiEvent(1.0, 60)] })
    expect(nextExpectedOnset(matchEvents(target, [note(1.0, 60)]), 60, 0)).toBeNull()
  })
})

describe('sectionsFromMarkers + score', () => {
  const track = parseTarget({
    piano: [midiEvent(0.5, 60), midiEvent(1.5, 64), midiEvent(2.5, 67), midiEvent(3.0, 72)],
  })

  it('splits the target into marker-bounded sections', () => {
    const sections = sectionsFromMarkers(track, [
      { time: 0, label: 'Intro' },
      { time: 2, label: 'Verse' },
    ])
    expect(sections.map((s) => s.label)).toEqual(['Intro', 'Verse'])
    expect(sections[0]).toMatchObject({ startSec: 0, endSec: 2 })
    expect(sections[1].endSec).toBeGreaterThanOrEqual(3.5)
  })

  it('falls back to bar sections from bpm when there are no markers', () => {
    const sections = sectionsFromMarkers(track, [], { bpm: 120, beatsPerBar: 4 })
    expect(sections.map((s) => s.label)).toEqual(['Bar 1', 'Bar 2'])
    expect(sections[0]).toMatchObject({ startSec: 0.5, endSec: 2.5 })
  })

  it('scores overall accuracy strictly and counts late notes separately', () => {
    const observed = [note(0.5, 60), note(1.72, 64), note(3.0, 72)] // 220 ms late on 64
    const result = matchEvents(track, observed)
    const scored = score(result)
    expect(scored.overall).toMatchObject({
      total: 4,
      hit: 2,
      late: 1,
      missed: 1, // 67 @ 2.5 never played
      accuracy: 0.5,
    })
  })

  it('scores per hand and honours the hand ranking filter', () => {
    const target = parseTarget(
      {
        left: [midiEvent(0.5, 36), midiEvent(2.5, 43)],
        right: [midiEvent(0.5, 60), midiEvent(2.5, 67)],
      },
      { handByTrack: { left: 'left', right: 'right' } },
    )
    const result = matchEvents(target, [note(0.5, 36), note(0.5, 60)])
    const right = score(result, { hand: 'right' })
    expect(right.overall.total).toBe(2)
    expect(right.overall.missed).toBe(1)
    expect(right.overall.accuracy).toBeCloseTo(0.5, 6)
    const hands = score(result)
    expect(hands.byHand.left).toMatchObject({ total: 2, hit: 1 })
    expect(hands.byHand.right).toMatchObject({ total: 2, hit: 1 })
  })

  it('ranks practiceThese worst section first and seeds the A–B loop pick', () => {
    const observed = [note(0.5, 60), note(1.5, 64)] // Intro perfect, Verse untouched
    const result = matchEvents(track, observed)
    const sections = sectionsFromMarkers(track, [
      { time: 0, label: 'Intro' },
      { time: 2, label: 'Verse' },
    ])
    const scored = score(result, { sections })
    expect(scored.bySection.map((s) => s.stats.accuracy)).toEqual([1, 0])
    expect(scored.practiceThese[0].section.label).toBe('Verse')
    expect(scored.practiceThese[1].section.label).toBe('Intro')
  })

  it('counts extras against the section and the overall stats', () => {
    const result = matchEvents(track, [note(0.5, 61), note(0.5, 60)])
    const sections = sectionsFromMarkers(track, [{ time: 0, label: 'Intro' }])
    const scored = score(result, { sections })
    expect(scored.overall.extra).toBe(1)
    expect(scored.bySection[0].stats.extra).toBe(1)
    expect(scored.overall.accuracy).toBeCloseTo(0.25, 6) // 1 of 4 target notes hit
  })
})

describe('score with pending notes (the denominator is the judged notes only)', () => {
  // Falsification anchor: if `tally` ever counts pending notes in
  // `stats.total`, these three tests fail — all-pending stops being "0
  // judged" and the in-progress 100% drops to a poisoned fraction.
  it('an all-pending result reports 0 judged and 0%, never an empty truthless total', () => {
    const target = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.0, 64)] })
    const result = matchEvents(target, [], { atSec: 0 }) // nothing due yet -> all pending
    expect(result.notes.map((j) => j.state)).toEqual(['pending', 'pending'])
    const scored = score(result)
    expect(scored.overall.pending).toBe(2)
    expect(scored.overall.total).toBe(0)
    expect(scored.overall.accuracy).toBe(0)
  })

  it('an in-progress run with everything-else-pending keeps its honest 100%', () => {
    const target = parseTarget({ piano: [midiEvent(1.0, 60), midiEvent(2.0, 64)] })
    // Pass stopped after the first note: 1 judged hit, 1 note still pending.
    const result = matchEvents(target, [note(1.0, 60)], { atSec: 1.05 })
    const scored = score(result)
    expect(scored.overall).toMatchObject({
      total: 1,
      hit: 1,
      missed: 0,
      pending: 1,
      accuracy: 1,
    })
  })

  it('a mixed run reports judged and pending counts in the same stats', () => {
    const target = parseTarget({
      piano: [midiEvent(1.0, 60), midiEvent(2.0, 64), midiEvent(3.0, 67)],
    })
    const result = matchEvents(target, [note(1.0, 60)], { atSec: 2.1 })
    // 1 hit + 1 missed (window opened before atSec) + 1 pending.
    const scored = score(result)
    expect(scored.overall).toMatchObject({
      total: 2,
      hit: 1,
      missed: 1,
      pending: 1,
      accuracy: 0.5,
    })
  })

  it('practiceThese ignores sections with no judged notes (all pending)', () => {
    const target = parseTarget({ piano: [midiEvent(10.0, 60), midiEvent(12.0, 62)] })
    const sections = [
      { index: 0, label: 'Bar 1', startSec: 9, endSec: 11 },
      { index: 1, label: 'Bar 2', startSec: 11, endSec: 13 },
    ]
    // The pass only got as far as Bar 2: Bar 1 is entirely still pending.
    const result = matchEvents(target, [note(12.0, 62)], { atSec: 4 })
    const scored = score(result, { sections })
    expect(scored.bySection[0].stats).toMatchObject({ total: 0, pending: 1 })
    expect(scored.bySection[1].stats).toMatchObject({ total: 1, hit: 1 })
    expect(scored.practiceThese.map((entry) => entry.section.label)).toEqual(['Bar 2'])
  })
})
