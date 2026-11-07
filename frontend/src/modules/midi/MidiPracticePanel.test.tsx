// @vitest-environment jsdom
/* These tests drive React's `act`; declaring the act-environment flag keeps
 * React from warning "not configured to support act(...)". */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MidiPracticePanel } from './MidiPracticePanel'

/**
 * Run-boundary + honest-denominator regression tests for the wired practice
 * path. The panel's external seams (session store, DAW bridge, PlayerSurface)
 * are faked so the real engine, roll and summary run end to end:
 *
 * - `useSession` -> fixture file + `TranscribeResult.tracks` target;
 * - `useDawBridge` -> the test drives `onMidiNoteOn` (a DAW note-on);
 * - `PlayerSurface` -> a prop capture the tests call like the real surface
 *   does (`onPosition`, `onPlayingChange`, `onWaitChange`), never re-timed.
 *
 * Falsification target (leg C-fix P1): removing the run-boundary reset in
 * `onRollPosition` must fail the wrap test — pass 2+ of the A–B loop would
 * otherwise judge DAW notes against the stale pre-wrap gate onset.
 */

/** Mock state the fake seams read/write; hoisted above the vi.mock factories. */
const harness = vi.hoisted(() => ({
  file: null as Record<string, unknown> | null,
  transcribeResult: null as Record<string, unknown> | null,
  playerProps: null as Record<string, unknown> | null,
  transportProps: null as Record<string, unknown> | null,
  dawConnected: true,
  onMidiNoteOn: null as ((pitch: number, velocity: number, instanceId: string) => void) | null,
}))

vi.mock('../../state/session', () => ({
  useSession: () => ({
    file: harness.file,
    transcribeResult: harness.transcribeResult,
    setModule: () => {},
  }),
}))

vi.mock('../../hooks/useDawBridge', () => ({
  useDawBridge: (opts?: {
    onMidiNoteOn?: (pitch: number, velocity: number, instanceId: string) => void
  }) => {
    harness.onMidiNoteOn = opts?.onMidiNoteOn ?? null
    return { status: null, dawConnected: harness.dawConnected }
  },
}))

vi.mock('../../player/PlayerSurface', () => ({
  PlayerSurface: (props: Record<string, unknown>) => {
    harness.playerProps = props
    return null
  },
}))

// The MIDI-only transport is a prop capture for the same reason: the panel's seam is what is being
// tested, and the transport's own frame arithmetic has its own test file.
vi.mock('./MidiTargetTransport', () => ({
  MidiTargetTransport: (props: Record<string, unknown>) => {
    harness.transportProps = props
    return null
  },
}))

/** Target: two notes at 10 s (pitch 60) and 12 s (pitch 62), 120 bpm. */
const TARGET = {
  tempo_bpm: 120,
  tracks: {
    piano: [
      { onset: 10, offset: 10.5, pitch: 60, velocity: 80, confidence: 1 },
      { onset: 12, offset: 12.5, pitch: 62, velocity: 80, confidence: 1 },
    ],
  },
}

const FILE = {
  fileId: 'f1',
  name: 'song',
  audioUrl: '/audio/f1',
  report: { duration_seconds: 30 },
}

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  harness.file = FILE
  harness.transcribeResult = TARGET
  harness.dawConnected = true
})

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
  harness.file = null
  harness.transcribeResult = null
  harness.playerProps = null
  harness.transportProps = null
  harness.dawConnected = true
  harness.onMidiNoteOn = null
})

async function mountPanel(): Promise<Record<string, unknown>> {
  host = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    root = createRoot(host!)
    root!.render(<MidiPracticePanel focus={false} />)
  })
  return harness.playerProps ?? {}
}

/** Mount a target-only panel and hand back the MIDI transport's captured props. */
async function mountTargetOnly(): Promise<Record<string, unknown>> {
  host = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    root = createRoot(host!)
    root!.render(<MidiPracticePanel focus={false} />)
  })
  return harness.transportProps ?? {}
}

/** Invoke one captured PlayerSurface prop (handlers are called like the real
 * surface calls them — transports do not time themselves in tests). */
function call(props: Record<string, unknown>, key: string, ...args: unknown[]): void {
  const handler = props[key]
  expect(typeof handler).toBe('function')
  ;(handler as (...a: unknown[]) => void)(...args)
}

describe('MidiPracticePanel with a MIDI target and no audio', () => {
  beforeEach(() => {
    harness.file = null
    harness.dawConnected = false
  })

  it('gives the target its own transport instead of the "import a track" gate', async () => {
    const props = await mountTargetOnly()
    // The roll exists (a target was handed over), so the panel is not gated…
    expect(host!.textContent).not.toContain('Import (and optionally transcribe) a track')
    // …the player is not mounted (no audio source)…
    expect(harness.playerProps).toBeNull()
    // …and the transport is, on the same seams the player uses, with the target's own length.
    expect(props.bpm).toBe(120)
    expect(typeof props.onPosition).toBe('function')
    expect(typeof props.onPlayingChange).toBe('function')
    expect((props.tracks as { piano: unknown[] }).piano).toHaveLength(2)
    // The panel says which clock it is on, so nothing is implied about audio that is not open.
    expect(host!.textContent).toContain('metronome clock')
  })

  it('judges notes against the target transport clock, end to end', async () => {
    const props = await mountTargetOnly()
    await act(async () => {
      call(props, 'onPlayingChange', true)
      call(props, 'onPosition', 10.0)
    })
    await act(async () => {
      call(harness, 'onMidiNoteOn', 60, 90, 'inst') // free play -> stamped at 10.0
      call(props, 'onPosition', 12.0)
      call(harness, 'onMidiNoteOn', 62, 90, 'inst') // stamped at 12.0
    })
    const text = host!.textContent!
    expect(text).toContain('100%')
    expect(text).toContain('2 notes judged')
    // A pass ended by the transport's stop is recorded, exactly as with the audio player.
    await act(async () => {
      call(props, 'onPlayingChange', false)
    })
    expect(host!.textContent).toContain('100%')
  })
})

describe('MidiPracticePanel run boundary (loop wrap / backward seek)', () => {
  it('a backward position resets the judged stream; pass 2 judges at the post-wrap onset', async () => {
    const props = await mountPanel()
    await act(async () => {
      call(props, 'onPlayingChange', true)
    })

    // Pass 1: park at bar 2's wait gate, answer it through the DAW bridge.
    await act(async () => {
      call(props, 'onPosition', 11.9)
    })
    await act(async () => {
      call(props, 'onWaitChange', true, 62)
    })
    await act(async () => {
      call(harness, 'onMidiNoteOn', 62, 90, 'inst')
    })
    // (the summary is hidden while the transport waits at the gate)
    await act(async () => {
      call(props, 'onWaitChange', false, null)
      call(props, 'onPosition', 12.4)
    })
    // Pre-wrap state: both passes' notes judged from one continuous stream.
    expect(host!.textContent).toContain('50%')
    expect(host!.textContent).toContain('2 notes judged')
    expect(host!.textContent).toContain('1 missed')

    // The loop wrap: 10 -> 12 -> 3 -> 4. Position 3 is materially backward —
    // a run boundary. The judged stream and gate onset reset; pass 1's hit
    // must not survive into pass 2's score.
    await act(async () => {
      call(props, 'onPosition', 3)
      call(props, 'onPosition', 4)
    })
    const afterWrap = host!.textContent!
    expect(afterWrap).toContain('No notes judged yet')
    expect(afterWrap).toContain('0 of 2 notes judged')
    expect(afterWrap).toContain('2 not yet judged')
    expect(afterWrap).not.toContain('50%')

    // Pass 2: the same wait gate re-arms; the DAW answer now timestamps at the
    // post-wrap gate onset (10.0), not the stale pre-wrap one (12.0).
    await act(async () => {
      call(props, 'onWaitChange', true, 60)
    })
    await act(async () => {
      call(harness, 'onMidiNoteOn', 60, 90, 'inst')
    })
    await act(async () => {
      call(props, 'onWaitChange', false, null)
    })
    // Roll far enough that pass 1's stale stream would show through.
    await act(async () => {
      call(props, 'onPosition', 10.4)
    })
    const passTwo = host!.textContent!
    expect(passTwo).toContain('100%')
    expect(passTwo).toContain('1 of 2 notes judged')
    expect(passTwo).toContain('1 not yet judged')
    expect(passTwo).not.toContain('50%')
  })

  it('forward movement (and worklet-scale jitter) never resets the judged stream', async () => {
    const props = await mountPanel()
    await act(async () => {
      call(props, 'onPlayingChange', true)
      call(props, 'onPosition', 10.0)
    })
    await act(async () => {
      call(harness, 'onMidiNoteOn', 60, 90, 'inst') // free play -> recorded at 10.0
    })
    await act(async () => {
      call(props, 'onPosition', 10.02) // worklet-scale forward step, no boundary
      call(props, 'onPosition', 12.0)
    })
    await act(async () => {
      call(harness, 'onMidiNoteOn', 62, 90, 'inst') // recorded at 12.0
    })
    const text = host!.textContent!
    expect(text).toContain('100%')
    expect(text).toContain('2 notes judged')
    expect(text).not.toContain('not yet judged')
  })
})
