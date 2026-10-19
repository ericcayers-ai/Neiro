/** Timeline helpers shared by Studio and the player overlay. */

export interface ChordSegment {
  chord: string
  start: number
  end: number
  confidence?: number
}

export interface ChordBlock {
  chord: string
  left: number
  width: number
  confidence?: number
}

/**
 * Position chord segments inside a visible window as percentages.
 * Segments fully outside the window are dropped; partial ones are clamped.
 */
export function chordLane(
  chords: ChordSegment[],
  viewStart: number,
  viewDur: number,
): ChordBlock[] {
  if (!Number.isFinite(viewDur) || viewDur <= 0) return []
  const blocks: ChordBlock[] = []
  for (const segment of chords) {
    const end = Math.max(segment.start + 0.001, segment.end)
    if (end <= viewStart || segment.start >= viewStart + viewDur) continue
    const start = Math.max(segment.start, viewStart)
    const stop = Math.min(end, viewStart + viewDur)
    blocks.push({
      chord: segment.chord,
      left: ((start - viewStart) / viewDur) * 100,
      width: Math.max(0.4, ((stop - start) / viewDur) * 100),
      confidence: segment.confidence,
    })
  }
  return blocks
}
