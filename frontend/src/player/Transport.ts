/**
 * Transport state machine for the shared player.
 *
 * Pure logic (no DOM, no audio) so it can be unit-tested in Node and reused by the
 * React app and the browser companion. The audio worklet is the clock; this model
 * decides what to do when the clock crosses a loop end, a wait point, or the end of
 * the source. "Wait mode" is real here: it stops playback, and only `resume()`
 * starts it again.
 */

export type TransportEvent = 'none' | 'loop' | 'wait' | 'ended'

export interface LoopRange {
  enabled: boolean
  start: number
  end: number
}

export interface TransportOptions {
  duration?: number
  loop?: Partial<LoopRange>
}

export class Transport {
  duration: number
  position = 0
  playing = false
  waiting = false
  ended = false
  loop: LoopRange
  waitPoints: number[] = []
  private waitIndex = 0

  constructor(options: TransportOptions = {}) {
    this.duration = Math.max(0, options.duration ?? 0)
    this.loop = {
      enabled: Boolean(options.loop?.enabled),
      start: Math.max(0, options.loop?.start ?? 0),
      end: Math.max(0, options.loop?.end ?? 0),
    }
  }

  setDuration(duration: number): void {
    this.duration = Math.max(0, duration)
  }

  setLoop(range: Partial<LoopRange>): void {
    this.loop = {
      enabled: Boolean(range.enabled ?? this.loop.enabled),
      start: Math.max(0, range.start ?? this.loop.start),
      end: Math.max(0, range.end ?? this.loop.end),
    }
  }

  setWaitPoints(points: number[]): void {
    this.waitPoints = [...points].filter((p) => Number.isFinite(p) && p >= 0).sort((a, b) => a - b)
    this.waitIndex = 0
  }

  seek(position: number): void {
    this.position = Math.min(Math.max(0, position), this.duration || Number.MAX_SAFE_INTEGER)
    this.ended = false
    this.waiting = false
    this.waitIndex = this.waitPoints.findIndex((p) => p > this.position)
    if (this.waitIndex < 0) this.waitIndex = this.waitPoints.length
  }

  play(from?: number): void {
    if (from != null) this.seek(from)
    this.playing = true
    this.ended = false
  }

  pause(): void {
    this.playing = false
  }

  /** Clear a wait gate and continue. Returns false when nothing was waiting. */
  resume(): boolean {
    if (!this.waiting) return false
    this.waiting = false
    this.playing = true
    return true
  }

  /** Advance the model by `dt` seconds and report the first boundary crossed. */
  tick(dt: number): TransportEvent {
    if (!this.playing || dt <= 0) return 'none'
    this.position += dt
    if (this.loop.enabled && this.loop.end > this.loop.start && this.position >= this.loop.end) {
      // Keep the overshoot so the beat grid does not drift at each wrap.
      this.position = this.loop.start + (this.position - this.loop.end)
      this.ended = false
      this.waitIndex = this.waitPoints.findIndex((p) => p > this.position)
      if (this.waitIndex < 0) this.waitIndex = this.waitPoints.length
      return 'loop'
    }
    const nextWait = this.waitPoints[this.waitIndex]
    if (nextWait != null && this.position >= nextWait) {
      this.waitIndex += 1
      this.waiting = true
      this.playing = false
      return 'wait'
    }
    if (this.duration > 0 && this.position >= this.duration) {
      this.position = this.duration
      this.playing = false
      this.ended = true
      return 'ended'
    }
    return 'none'
  }

  /** Count-in duration for a tempo, in seconds (one bar of 4/4 by default). */
  static countInSeconds(bpm: number, beats = 4): number {
    const safe = Math.min(300, Math.max(20, bpm || 100))
    return (60 / safe) * Math.max(0, beats)
  }

  get snapshot() {
    return {
      position: this.position,
      playing: this.playing,
      waiting: this.waiting,
      ended: this.ended,
    }
  }
}

/** Clamp a relative seek to the track. Exported so the UI and tests share it. */
export function clampSeek(position: number, delta: number, duration: number): number {
  const limit = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
  return Math.min(limit, Math.max(0, position + delta))
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}
