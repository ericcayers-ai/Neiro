// @vitest-environment jsdom
/* These tests drive React's `act`; declaring the act-environment flag keeps
 * React from warning "not configured to support act(...)" in the jsdom env. */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { JUDGEMENT_FRACTION, PianoRoll, ROLL_HEIGHT_PX, drawRoll, type PianoRollProps } from './PianoRoll'
import { matchEvents, parseTarget, type JudgedNote, type RawTargetEvent, type TargetNote } from './engine'
import { rollLayout } from './geometry'

/* A fake 2d context that records calls and allows style properties; injected
 * through `PianoRoll.createContext` instead of mocking `HTMLCanvasElement`
 * globally, so other tests still see jsdom's real (null-context) canvas. */
interface RecordedCall {
  op: string
  args: number[]
}

function fakeContext() {
  const calls: RecordedCall[] = []
  const raw = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn((a: number, b: number, c: number, d: number, e: number, f: number) => {
      calls.push({ op: 'setTransform', args: [a, b, c, d, e, f] })
    }),
    clearRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ op: 'clearRect', args: [x, y, w, h] })
    }),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ op: 'fillRect', args: [x, y, w, h] })
    }),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ op: 'strokeRect', args: [x, y, w, h] })
    }),
    globalAlpha: 1,
    lineWidth: 1,
    fillStyle: '',
    strokeStyle: '',
  }
  return { ctx: raw as unknown as CanvasRenderingContext2D, calls, raw }
}

/* Notes: one target; the observed stream marks the first note hit, and leaves
 * the rest pending against `atSec = -Infinity` (complete future reference). */
function buildJudged(now: number): JudgedNote[] {
  const events: RawTargetEvent[] = [
    { onset: now - 2, offset: now - 1.5, pitch: 60, velocity: 80, channel: 1 }, // played on time -> hit
    { onset: now - 2, offset: now - 1.5, pitch: 64, velocity: 80, channel: 1 }, // unplayed -> pending
    { onset: now + 2, offset: now + 3, pitch: 67, velocity: 80, channel: 0 }, // future -> pending
    { onset: now + 4, offset: now + 5, pitch: 72, velocity: 80, channel: 0 }, // future -> pending
  ]
  return matchEvents(parseTarget({ a: events }), [{ timeSec: now - 2, midi: 60 }], {
    atSec: Number.NEGATIVE_INFINITY,
  }).notes
}

function judged(state: JudgedNote['state'], startSec: number, endSec: number): JudgedNote {
  const note: TargetNote = {
    startSec,
    endSec,
    midi: 60,
    velocity: 80,
    track: 'a',
    hand: 'left',
    index: 0,
  }
  return { note, state }
}

function baseProps(now: number, overrides: Partial<PianoRollProps> = {}): PianoRollProps {
  return { notes: buildJudged(now), nowSec: now, height: 160, ...overrides }
}

const WIDTH = 720
const JUDGEMENT_X = Math.round(WIDTH * JUDGEMENT_FRACTION)
const PPS = 120

describe('PianoRoll SSR safety', () => {
  it('renders static markup without touching window, document or a canvas', () => {
    // No canvas stubs anywhere: if the component touched the canvas during
    // render this would throw, the way a browser-only component does in SSR.
    const html = renderToStaticMarkup(<PianoRoll {...baseProps(10)} />)
    expect(html).toContain('<canvas')
    expect(html).toContain('role="img"')
    expect(html).toContain('Practice roll')
  })

  it('renders the canvas with the given logical height', () => {
    const html = renderToStaticMarkup(<PianoRoll {...baseProps(10, { height: 220 })} />)
    expect(html).toContain('height:220px')
  })

  it('default height is ROLL_HEIGHT_PX and an ariaLabel override reaches the markup', () => {
    const html = renderToStaticMarkup(
      <PianoRoll notes={buildJudged(10)} nowSec={10} ariaLabel="roll" />,
    )
    expect(html).toContain(`height:${ROLL_HEIGHT_PX}px`)
    expect(html).toContain('aria-label="roll"')
  })
})

describe('PianoRoll drawing (jsdom, injected fake context)', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    root?.unmount()
    host?.remove()
    root = null
    host = null
  })

  async function mount(props: PianoRollProps, capture = fakeContext()) {
    host = document.body.appendChild(document.createElement('div'))
    await act(async () => {
      root = createRoot(host!)
      root!.render(<PianoRoll {...props} createContext={() => capture.ctx} />)
    })
    return capture
  }

  it('draws the judgement line and one filled rect per pending-or-hit visible note', async () => {
    const now = 10
    const capture = await mount(baseProps(now))
    const line = capture.calls.find((c) => c.op === 'fillRect' && c.args[2] === 2 && c.args[3] === 160)
    expect(line).toBeDefined()
    expect(line!.args[0]).toBe(JUDGEMENT_X - 1)
    expect(line!.args[1]).toBe(0)

    // The hit and all three pending notes overlap the visible window, so the
    // notes add 4 fills to the one judgement-line fill.
    const noteFills = capture.calls.filter((c) => c.op === 'fillRect') as RecordedCall[]
    const draws = noteFills.filter((c) => !(c.args[2] === 2 && c.args[3] === 160))
    expect(draws).toHaveLength(4)
    // Their x values sit at the expected x for each onset: judgement line at
    // JUDGEMENT_X, notes offset by (onset - now) * PPS.
    const expectedX = [now - 2, now - 2, now + 2, now + 4].map((t) => JUDGEMENT_X + (t - now) * PPS)
    expect(draws.map((c) => c.args[0]).sort((a, b) => a - b)).toEqual(
      [...expectedX].sort((a, b) => a - b),
    )
  })

  it('excludes notes outside the visible window from the draw calls', async () => {
    const now = 10
    // The window's right edge is (width - judgementX) seconds ahead of now;
    // a note at now+10 is past it (the in-window notes end at now+4).
    const capture = await mount({
      ...baseProps(now),
      notes: [...buildJudged(now), judged('pending', now + 10, now + 11)],
    })
    const fills = capture.calls.filter((c) => c.op === 'fillRect' && c.args[2] !== 2)
    const farX = JUDGEMENT_X + 10 * PPS
    expect(fills.some((c) => c.args[0] === farX)).toBe(false)
    // Only the four in-window notes were drawn.
    expect(fills).toHaveLength(4)
  })

  it('redraws when nowSec changes and never schedules a timer (no second clock)', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    try {
      const now = 10
      const capture = await mount(baseProps(now))
      expect(capture.calls.filter((c) => c.op === 'clearRect')).toHaveLength(1)
      await act(async () => {
        root!.render(<PianoRoll {...baseProps(now + 1)} createContext={() => capture.ctx} />)
      })
      expect(capture.calls.filter((c) => c.op === 'clearRect')).toHaveLength(2)
      expect(interval).not.toHaveBeenCalled()
      expect(timeout).not.toHaveBeenCalled()
    } finally {
      interval.mockRestore()
      timeout.mockRestore()
    }
  })

  it('is devicePixelRatio-aware: transform is set from the dpr and the logical size is drawn', async () => {
    const capture = await mount(baseProps(10))
    expect(capture.raw.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(capture.raw.clearRect).toHaveBeenCalledWith(0, 0, WIDTH, 160)
  })

  it('reports its logical size through onSizeChange', async () => {
    const onSizeChange = vi.fn()
    await mount(baseProps(10, { height: 200, onSizeChange }))
    expect(onSizeChange).toHaveBeenCalledWith(WIDTH, 200)
  })

  it('paints a missed note as an outline (strokeRect) without a fill', () => {
    const capture = fakeContext()
    const now = 5
    drawRoll(
      capture.ctx,
      [judged('missed', now - 1, now)],
      rollLayout({ now, pixelsPerSecond: PPS, judgementX: JUDGEMENT_X, height: 160 }),
      { width: WIDTH, dpr: 1, showHands: true },
    )
    const strokes = capture.calls.filter((c) => c.op === 'strokeRect')
    expect(strokes).toHaveLength(1)
    expect(strokes[0].args).toEqual([JUDGEMENT_X - PPS, expect.any(Number), PPS, expect.any(Number)])
    // No fill for the missed note: only the judgement line was filled.
    expect(capture.calls.filter((c) => c.op === 'fillRect')).toHaveLength(1)
  })

  it('draws the judgement line at the fixed fraction of the width (direct seam)', () => {
    const capture = fakeContext()
    drawRoll(
      capture.ctx,
      [],
      rollLayout({ now: 5, pixelsPerSecond: PPS, judgementX: JUDGEMENT_X, height: 160 }),
      { width: WIDTH, dpr: 1, showHands: false },
    )
    const lines = capture.calls.filter((c) => c.op === 'fillRect' && c.args[3] === 160)
    expect(lines).toHaveLength(1)
    expect(lines[0].args).toEqual([JUDGEMENT_X - 1, 0, 2, 160])
  })

  it('applies noteAlpha to a note, so leg D can fade a mastered bar', () => {
    const capture = fakeContext()
    const now = 5
    const layout = rollLayout({ now, pixelsPerSecond: PPS, judgementX: JUDGEMENT_X, height: 160 })
    // A pending note is filled; half alpha must reach globalAlpha at the fill.
    const alphas: number[] = []
    const spy = capture.raw as unknown as { globalAlpha: number }
    const original = Object.getOwnPropertyDescriptor(spy, 'globalAlpha')
    Object.defineProperty(spy, 'globalAlpha', {
      get: () => (original?.get ? original.get.call(spy) : 1),
      set: (value: number) => {
        alphas.push(value)
      },
      configurable: true,
    })

    drawRoll(capture.ctx, [judged('pending', now - 1, now)], layout, {
      width: WIDTH,
      dpr: 1,
      showHands: false,
      noteAlpha: () => 0.25,
    })

    // The judgement line is drawn at alpha 1 first, then the note at paint.fillAlpha * 0.25.
    expect(alphas).toContain(1)
    expect(alphas.some((value) => value > 0 && value < 0.3)).toBe(true)
  })

  it('clamps a bad noteAlpha instead of making the note invisible or too bright', () => {
    const capture = fakeContext()
    const now = 5
    const layout = rollLayout({ now, pixelsPerSecond: PPS, judgementX: JUDGEMENT_X, height: 160 })
    const seen: number[] = []
    const spy = capture.raw as unknown as { globalAlpha: number }
    Object.defineProperty(spy, 'globalAlpha', {
      get: () => 1,
      set: (value: number) => {
        seen.push(value)
      },
      configurable: true,
    })
    for (const bad of [Number.NaN, -3, 9]) {
      seen.length = 0
      drawRoll(capture.ctx, [judged('pending', now - 1, now)], layout, {
        width: WIDTH,
        dpr: 1,
        showHands: false,
        noteAlpha: () => bad,
      })
      // NaN falls back to 1, -3 clamps to 0, 9 clamps to 1; none may exceed the paint alpha.
      expect(seen.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    }
  })
})
