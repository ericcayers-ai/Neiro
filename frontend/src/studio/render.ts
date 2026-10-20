/** Map the Studio preview controls to a queued render request. */

export interface RenderRequest {
  /** Duration scale for the engine (1/speed). */
  rate: number
  semitones: number
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.max(lo, Math.min(hi, value))
}

export function renderRequest(transpose: number, speed: number): RenderRequest {
  return {
    rate: Number(clamp(1 / (speed || 1), 0.25, 4).toFixed(4)),
    semitones: Math.round(clamp(transpose, -36, 36) * 100) / 100,
  }
}
