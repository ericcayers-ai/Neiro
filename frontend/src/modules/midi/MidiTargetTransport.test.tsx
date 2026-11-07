// @vitest-environment jsdom
/* These tests drive React's `act`; declaring the act-environment flag keeps
 * React from warning "not configured to support act(...)". */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '../../i18n'
import { MidiTargetTransport, type FrameLoop, type TargetLoopRequest } from './MidiTargetTransport'

/**
 * A MIDI target with no audio: the practice roll needs a clock it did not have before.
 *
 * The component is the shell; the arithmetic belongs to the repo's existing `Transport` state
 * machine. These tests therefore assert the *seam* the panel depends on — position and playing
 * events on the same callbacks `PlayerSurface` uses — by stepping a hand-driven frame loop, never
 * by waiting on timers and never by creating a second expectation of what `Transport.tick` does.
 */

/** Hand-driven frame source: no timers, no rAF, deterministic transport time. */
function manualLoop() {
  let frame: ((nowMs: number) => void) | null = null
  let cancelled = false
  const loop: FrameLoop = (fn) => {
    frame = fn
    cancelled = false
    return () => {
      cancelled = true
    }
  }
  return {
    loop,
    step(nowMs: number) {
      if (!frame) throw new Error('no frame scheduled — is the transport playing?')
      expect(cancelled).toBe(false)
      frame(nowMs)
    },
  }
}

/** 10 s target: one note every second, the last ending at 10 s. */
const TRACKS = {
  piano: Array.from({ length: 10 }, (_, index) => ({
    onset: index,
    offset: index + 1,
    pitch: 60 + index,
  })),
}

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
})

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

interface Mounted {
  positions: number[]
  playing: boolean[]
  buttons: () => HTMLButtonElement[]
  text: () => string
}

async function mount(options: {
  tracks?: typeof TRACKS
  practiceLoop?: TargetLoopRequest | null
  bpm?: number
} = {}): Promise<{ mounted: Mounted; frames: ReturnType<typeof manualLoop> }> {
  const frames = manualLoop()
  const positions: number[] = []
  const playing: boolean[] = []
  await act(async () => {
    root = createRoot(host!)
    root.render(
      <I18nProvider>
        <MidiTargetTransport
          tracks={options.tracks ?? TRACKS}
          bpm={options.bpm ?? 100}
          practiceLoop={options.practiceLoop ?? null}
          frameLoop={frames.loop}
          onPosition={(position) => positions.push(position)}
          onPlayingChange={(isPlaying) => playing.push(isPlaying)}
        />
      </I18nProvider>,
    )
  })
  return {
    frames,
    mounted: {
      positions,
      playing,
      buttons: () => Array.from(host!.querySelectorAll('button')),
      text: () => host!.textContent ?? '',
    },
  }
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

describe('MidiTargetTransport (a target with no audio)', () => {
  it('states the clock it is using, with the target tempo', async () => {
    const { mounted } = await mount({ bpm: 84 })
    // The bar says "metronome clock" and the tempo: no pitch/speed/transpose is claimed.
    expect(mounted.text()).toContain('metronome clock')
    expect(mounted.text()).toContain('84 BPM')
    expect(mounted.text()).toContain('0:00 / 0:10')
  })

  it('emits transport positions on the same seam the player uses', async () => {
    const { mounted, frames } = await mount()
    await click(mounted.buttons()[0])

    expect(mounted.playing).toEqual([true])
    await act(async () => {
      frames.step(1000) // establishes the time base
      frames.step(1500) // +0.5 s
    })
    expect(mounted.positions.at(-1)).toBeCloseTo(0.5, 5)
    await act(async () => {
      frames.step(3000) // +1.5 s
    })
    expect(mounted.positions.at(-1)).toBeCloseTo(2, 5)
    // The readout follows at ~10 Hz rather than 60.
    expect(mounted.text()).toContain('0:02')
  })

  it('stops at the end of the target and reports it once', async () => {
    const { mounted, frames } = await mount({
      tracks: { piano: [{ onset: 0, offset: 1, pitch: 60 }] },
    })
    await click(mounted.buttons()[0])
    await act(async () => {
      frames.step(0)
      frames.step(1000)
    })
    expect(mounted.positions.at(-1)).toBeCloseTo(1, 5)
    expect(mounted.playing).toEqual([true, false])
    // Not still playing: the frame loop was cancelled, and the button offers Play again.
    expect(mounted.buttons()[0].textContent).toBe('Play')
    expect(mounted.buttons()[0].getAttribute('aria-pressed')).toBe('false')
  })

  it('a section-loop request seeks to its start and plays, like the player', async () => {
    const { mounted } = await mount({
      practiceLoop: { start: 4, end: 6, token: 1 },
    })
    // The mount parks the transport at 0, then the request moves it to the section start.
    expect(mounted.positions).toEqual([0, 4])
    expect(mounted.playing).toEqual([true])
    expect(mounted.text()).toContain('0:04')
  })

  it('a section loop wraps instead of running past its end', async () => {
    const { mounted, frames } = await mount({ practiceLoop: { start: 4, end: 6, token: 2 } })
    await act(async () => {
      frames.step(0)
      frames.step(2500) // 4 -> 6.5, i.e. past the loop end
    })
    // Transport keeps the overshoot, so the wrap lands 0.5 s into the section.
    expect(mounted.positions.at(-1)).toBeCloseTo(4.5, 5)
    expect(mounted.playing).toEqual([true])
  })

  it('restart returns to the top and drops a leftover section loop', async () => {
    const { mounted, frames } = await mount({ practiceLoop: { start: 4, end: 6, token: 3 } })
    await click(mounted.buttons()[1]) // Restart
    expect(mounted.positions.at(-1)).toBe(0)
    await act(async () => {
      frames.step(0)
      frames.step(7000)
    })
    // No wrap at 6 s: the whole target plays.
    expect(mounted.positions.at(-1)).toBeCloseTo(7, 5)
  })

  it('pausing reports the stop exactly once, which is what ends a practice pass', async () => {
    const { mounted, frames } = await mount()
    await click(mounted.buttons()[0])
    await act(async () => {
      frames.step(0)
      frames.step(1000)
    })
    await click(mounted.buttons()[0]) // Pause
    expect(mounted.playing).toEqual([true, false])
    expect(mounted.positions.at(-1)).toBeCloseTo(1, 5)
  })
})
