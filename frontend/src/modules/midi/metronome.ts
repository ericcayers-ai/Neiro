/** Phase-locked metronome clicks aligned to BPM + transport playhead. */

export type MetronomeHandle = {
  stop: () => void
}

/**
 * Schedule clicks so beat 0 lands on `downbeatAt` (absolute AudioContext time
 * corresponding to musical time 0 / selection start). Uses look-ahead scheduling.
 */
export function startPhaseLockedMetronome(opts: {
  bpm: number
  /** Current playhead musical time in seconds when started. */
  playheadSec: number
  /** AudioContext.currentTime when playheadSec was sampled. */
  audioNow: number
  /** Musical time of the nearest downbeat ≤ playhead (usually 0 or loop start). */
  downbeatSec?: number
  accentEvery?: number
  volume?: number
  context?: AudioContext
}): MetronomeHandle {
  const bpm = Math.max(20, Math.min(300, opts.bpm || 120))
  const beatDur = 60 / bpm
  const accentEvery = opts.accentEvery ?? 4
  const volume = opts.volume ?? 0.07
  const downbeatSec = opts.downbeatSec ?? 0
  const ctx = opts.context ?? new AudioContext()
  const ownCtx = !opts.context

  let stopped = false
  let timer = 0

  // Beat index of the next click at or after playhead.
  const elapsed = Math.max(0, opts.playheadSec - downbeatSec)
  let nextBeat = Math.ceil(elapsed / beatDur - 1e-9)
  if (nextBeat < 0) nextBeat = 0

  const scheduleAhead = 0.12
  const tickMs = 40

  const click = (when: number, accent: boolean) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = accent ? 1320 : 880
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(volume * (accent ? 1.2 : 0.85), when + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(when)
    osc.stop(when + 0.06)
  }

  const pump = () => {
    if (stopped) return
    const horizon = ctx.currentTime + scheduleAhead
    for (;;) {
      const musicalT = downbeatSec + nextBeat * beatDur
      const when =
        opts.audioNow + (musicalT - opts.playheadSec) * (1 /* speed=1 for metronome clock */)
      if (when > horizon) break
      if (when >= ctx.currentTime - 0.02) {
        click(Math.max(when, ctx.currentTime + 0.001), nextBeat % accentEvery === 0)
      }
      nextBeat += 1
    }
    timer = window.setTimeout(pump, tickMs)
  }

  void ctx.resume().then(() => pump())

  return {
    stop: () => {
      stopped = true
      window.clearTimeout(timer)
      if (ownCtx) void ctx.close()
    },
  }
}
