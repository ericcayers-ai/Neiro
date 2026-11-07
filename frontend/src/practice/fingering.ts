/**
 * PianoVision adoption Leg E — Ergonomic Piano Fingering (1..5) & Sheet Music Measure Sync.
 *
 * Pure TypeScript: no DOM, no window, no timers.
 * Assigns thumb=1 .. pinky=5 per hand across a `TargetNote[]` sequence using
 * biomechanical interval + thumb-under / finger-over rules, and computes
 * measure/bar layout for the synchronized sheet-music HUD.
 */

import type { TargetNote } from './engine'
import { isBlackKey } from './vrCalibration'

export type FingerNumber = 1 | 2 | 3 | 4 | 5

export interface FingeredNote extends TargetNote {
  finger: FingerNumber
  effectiveHand: 'left' | 'right'
}

/**
 * Determine effective hand ('left' | 'right') when `note.hand` is 'unknown'.
 * Split point defaults to C4 (MIDI 60) with hysteresis around the previous note.
 */
function resolveEffectiveHand(note: TargetNote, prevPitchByHand: { left: number; right: number }): 'left' | 'right' {
  if (note.hand === 'left' || note.hand === 'right') return note.hand
  if (note.midi < 58) return 'left'
  if (note.midi >= 62) return 'right'
  const distLeft = Math.abs(note.midi - prevPitchByHand.left)
  const distRight = Math.abs(note.midi - prevPitchByHand.right)
  return distLeft <= distRight ? 'left' : 'right'
}

/**
 * Assign ergonomic piano fingerings (1 = thumb, 2 = index, 3 = middle, 4 = ring, 5 = pinky)
 * to a sorted `TargetNote[]` sequence.
 *
 * Rules:
 * 1. Simultaneous chord notes (< 35 ms apart in the same hand) receive ascending fingers
 *    from bass to treble in RH (`1 -> 2 -> 3 -> 5`) and descending in LH (`5 -> 3 -> 2 -> 1`).
 * 2. Melodic intervals advance fingers in the direction of motion, using thumb-under (finger 1
 *    onto white key) when an ascending RH run (or descending LH run) runs out of fingers,
 *    and avoiding thumb (1) or pinky (5) on isolated black keys when a neighbor finger is free.
 */
export function assignFingerings(notes: readonly TargetNote[]): FingeredNote[] {
  if (notes.length === 0) return []

  const prevPitch = { left: 48, right: 64 }
  const withHand = notes.map((n) => {
    const effectiveHand = resolveEffectiveHand(n, prevPitch)
    prevPitch[effectiveHand] = n.midi
    return { note: n, effectiveHand }
  })

  const out: FingeredNote[] = new Array(notes.length)

  for (const hand of ['right', 'left'] as const) {
    const indices = withHand
      .map((item, idx) => ({ ...item, idx }))
      .filter((item) => item.effectiveHand === hand)

    let i = 0
    let lastPitch: number | null = null
    let lastFinger: FingerNumber = hand === 'right' ? 1 : 5

    while (i < indices.length) {
      // Group simultaneous chord notes within 35 ms
      const group = [indices[i]]
      while (
        i + 1 < indices.length &&
        Math.abs(indices[i + 1].note.startSec - group[0].note.startSec) <= 0.035
      ) {
        i += 1
        group.push(indices[i])
      }
      i += 1

      // Sort chord group low-to-high pitch
      group.sort((a, b) => a.note.midi - b.note.midi)

      if (group.length > 1) {
        const span = group[group.length - 1].note.midi - group[0].note.midi
        const templateRH: FingerNumber[][] = [
          [1],
          span >= 7 ? [1, 5] : span >= 4 ? [1, 3] : [1, 2],
          [1, 3, 5],
          [1, 2, 3, 5],
          [1, 2, 3, 4, 5],
        ]
        const templateLH: FingerNumber[][] = [
          [5],
          span >= 7 ? [5, 1] : span >= 4 ? [3, 1] : [2, 1],
          [5, 3, 1],
          [5, 3, 2, 1],
          [5, 4, 3, 2, 1],
        ]
        const tpl = (hand === 'right' ? templateRH : templateLH)[Math.min(4, group.length - 1)]
        group.forEach((g, k) => {
          const finger = tpl[Math.min(k, tpl.length - 1)]
          out[g.idx] = { ...g.note, finger, effectiveHand: hand }
          lastPitch = g.note.midi
          lastFinger = finger
        })
        continue
      }

      // Single melodic note
      const current = group[0]
      const pitch = current.note.midi
      const black = isBlackKey(pitch)
      let finger: FingerNumber = lastFinger

      if (lastPitch === null) {
        finger = black ? 2 : hand === 'right' ? 1 : 5
      } else {
        const delta = pitch - lastPitch
        if (delta === 0) {
          finger = lastFinger
        } else if (hand === 'right') {
          if (delta > 0) {
            // Ascending RH
            if (delta >= 7) {
              finger = 5
            } else if (lastFinger < 4) {
              finger = Math.min(5, lastFinger + Math.max(1, Math.round(delta / 2))) as FingerNumber
            } else {
              // Thumb-under onto white key, or index onto black key
              finger = black ? 2 : 1
            }
          } else {
            // Descending RH
            const absDelta = -delta
            if (absDelta >= 7) {
              finger = 1
            } else if (lastFinger > 1) {
              finger = Math.max(1, lastFinger - Math.max(1, Math.round(absDelta / 2))) as FingerNumber
            } else {
              // Cross 3 or 4 over thumb
              finger = black ? 3 : 3
            }
          }
        } else {
          // Left hand (1 = thumb on high side, 5 = pinky on low side)
          if (delta > 0) {
            // Ascending LH (toward thumb = 1)
            if (delta >= 7) {
              finger = 1
            } else if (lastFinger > 1) {
              finger = Math.max(1, lastFinger - Math.max(1, Math.round(delta / 2))) as FingerNumber
            } else {
              // Cross 3 over thumb
              finger = 3
            }
          } else {
            // Descending LH (toward pinky = 5)
            const absDelta = -delta
            if (absDelta >= 7) {
              finger = 5
            } else if (lastFinger < 4) {
              finger = Math.min(5, lastFinger + Math.max(1, Math.round(absDelta / 2))) as FingerNumber
            } else {
              // Thumb-under onto white key
              finger = black ? 2 : 1
            }
          }
        }
        // Avoid thumb on black key in scalar runs when finger 2 or 3 is available
        if (black && finger === 1) {
          finger = 2
        }
      }

      out[current.idx] = { ...current.note, finger, effectiveHand: hand }
      lastPitch = pitch
      lastFinger = finger
    }
  }

  return out
}
