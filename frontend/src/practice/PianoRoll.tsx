import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PIXELS_PER_SECOND,
  HAND_COLOURS,
  NEUTRAL_COLOUR,
  notePaint,
  noteRect,
  rollLayout,
  visibleNotes,
  type RollLayout,
} from './geometry'
import type { JudgedNote } from './engine'

/**
 * Falling-note practice roll (PianoVision adoption leg B) — the canvas half.
 *
 * Pure presentation: `notes` are the `matchEvents` judgements, `nowSec` is the
 * repo's OWN transport position (one clock — the audio worklet's, read in
 * `PlayerSurface` and passed down; there is deliberately no interval, no rAF
 * loop and no second clock here — the roll redraws only when a prop changes).
 *
 * SSR-safe: nothing touches `window`, `document` or a canvas at module scope or
 * during render; all canvas work happens inside effects, so the repo's
 * `renderToString` tests pass unchanged.
 */

export const ROLL_HEIGHT_PX = 180
/** Judgement line sits at this fraction of the visible width. */
export const JUDGEMENT_FRACTION = 0.28
/** Default CSS width when measurement is impossible (jsdom has no layout). */
export const DEFAULT_ROLL_WIDTH = 720
/** Judgement-line fill colour, drawn at `judgementX - 1` with width 2. */
const JUDGEMENT_COLOUR = '#e2e8f0'

export interface PianoRollProps {
  /** Judged target notes (from the practice engine's `matchEvents`). */
  notes: JudgedNote[]
  /** Transport position in seconds — fed by the caller, never sampled here. */
  nowSec: number
  pixelsPerSecond?: number
  /** Colour notes by hand (default true); off draws everything in one hue. */
  showHands?: boolean
  height?: number
  /** Reports the measured logical canvas size (CSS px). */
  onSizeChange?: (widthPx: number, heightPx: number) => void
  /** Test seam: jsdom has no 2d context, so tests inject a fake here instead of
   * mocking `HTMLCanvasElement` globally. */
  createContext?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null
  ariaLabel?: string
}

export interface RollDrawOptions {
  width: number
  dpr: number
  showHands: boolean
}

/**
 * The draw pass, exported so the drawing rules are testable without a real
 * canvas. Everything is axis-aligned rects: one 2px judgement line, then one
 * rect per visible note (fill and/or outline depending on its state — see
 * `notePaint`).
 */
export function drawRoll(
  ctx: CanvasRenderingContext2D,
  notes: readonly JudgedNote[],
  layout: RollLayout,
  options: RollDrawOptions,
): void {
  const { width, dpr, showHands } = options
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, layout.height)

  // Judgement line at a fixed x: the notes fall toward it.
  ctx.globalAlpha = 1
  ctx.fillStyle = JUDGEMENT_COLOUR
  ctx.fillRect(layout.judgementX - 1, 0, 2, layout.height)

  // Horizontal window in transport time: the distance the judgement line
  // sits from each screen edge, in seconds (so the cull edges line up with
  // the canvas edges), to the screen's right edge.
  const backSeconds = layout.judgementX / layout.pixelsPerSecond
  const aheadSeconds = (width - layout.judgementX) / layout.pixelsPerSecond
  const visible = visibleNotes(notes, {
    fromSec: layout.now - backSeconds,
    toSec: layout.now + aheadSeconds,
  })

  for (const judged of visible) {
    const rect = noteRect(judged, layout)
    if (rect.x + rect.w < 0 || rect.x > width || rect.y > layout.height) continue
    const colour = showHands ? HAND_COLOURS[rect.hand] : NEUTRAL_COLOUR
    const paint = notePaint(rect.state)
    if (paint.fillAlpha > 0) {
      ctx.globalAlpha = paint.fillAlpha
      ctx.fillStyle = colour
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    if (paint.strokeWidth > 0) {
      ctx.globalAlpha = 1
      ctx.lineWidth = paint.strokeWidth
      ctx.strokeStyle = colour
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

export function PianoRoll({
  notes,
  nowSec,
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  showHands = true,
  height = ROLL_HEIGHT_PX,
  onSizeChange,
  createContext,
  ariaLabel = 'Practice roll',
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(DEFAULT_ROLL_WIDTH)
  const onSizeChangeRef = useRef(onSizeChange)
  onSizeChangeRef.current = onSizeChange

  // Measure the container width so the roll fills its panel. ResizeObserver is
  // guarded: it is absent in jsdom and the fallback keeps the default width.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      if (Number.isFinite(next) && next > 0) setWidth(next)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    onSizeChangeRef.current?.(width, height)
  }, [width, height])

  // Redraw on prop change only — no animation loop, no timers.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const factory = createContext ?? ((c: HTMLCanvasElement) => c.getContext('2d'))
    const ctx = factory(canvas)
    if (!ctx) return
    const dpr =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    drawRoll(ctx, notes, rollLayout({ now: nowSec, pixelsPerSecond, judgementX: Math.round(width * JUDGEMENT_FRACTION), height }), {
      width,
      dpr,
      showHands,
    })
  }, [notes, nowSec, pixelsPerSecond, showHands, height, width, createContext])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      className="practice-roll-canvas"
      style={{ width: '100%', height, display: 'block' }}
    />
  )
}
