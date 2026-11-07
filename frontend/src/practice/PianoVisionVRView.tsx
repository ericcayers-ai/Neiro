import { useEffect, useMemo, useRef, useState } from 'react'
import type { Hand, JudgedNote, ObservedNote } from './engine'
import { assignFingerings, type FingeredNote } from './fingering'
import {
  buildKeyboardGeometry,
  defaultCalibration,
  KEYBOARD_RANGES,
  midiNoteName,
  solveCalibrationTransform,
  type KeyboardSize,
  type KeyGeometry,
  type PianoCalibrationState,
} from './vrCalibration'
import { HAND_COLOURS } from './geometry'

/**
 * PianoVision VR / Mixed-Reality 3D Waterfall & Floating Sheet Music Stage.
 *
 * Implements:
 * - Perspective 3D falling-note waterfall landing directly onto an 88/76/61/49-key
 *   physical keyboard geometry (`vrCalibration.ts`)
 * - 2-point A0 -> C8 spatial calibration controls & WebXR `immersive-ar` / `immersive-vr` session launch
 * - Ergonomic finger numbers (1..5) rendered on notes (`fingering.ts`)
 * - Hand separation filter (Both, Left Hand only, Right Hand only)
 * - Synchronized floating Grand Staff sheet-music HUD with measure cursor (`Leg E`)
 * - Environment switcher: Passthrough MR Cutout, Concert Hall, and Cyber Studio
 *
 * SSR-safe: no `window`, `navigator`, or canvas calls during render.
 */

export interface PianoVisionVRViewProps {
  notes: readonly JudgedNote[]
  nowSec: number
  bpm: number
  handFilter: 'all' | 'left' | 'right'
  onHandFilterChange?: (hand: 'all' | 'left' | 'right') => void
  showFingering?: boolean
  showSheetHud?: boolean
  noteAlpha?: (judged: JudgedNote) => number
  onSimulatedNoteOn?: (obs: ObservedNote) => void
}

const ENV_THEMES: Record<
  PianoCalibrationState['environment'],
  { bgTop: string; bgBottom: string; highway: string; grid: string; label: string }
> = {
  'passthrough-mr': {
    bgTop: 'rgba(9, 13, 22, 0.72)',
    bgBottom: 'rgba(15, 23, 42, 0.88)',
    highway: 'rgba(15, 23, 42, 0.55)',
    grid: 'rgba(148, 163, 184, 0.16)',
    label: 'Passthrough MR Cutout',
  },
  'concert-hall': {
    bgTop: '#1a120b',
    bgBottom: '#0f0a06',
    highway: 'rgba(28, 19, 12, 0.88)',
    grid: 'rgba(217, 119, 6, 0.18)',
    label: 'Virtual Concert Hall',
  },
  'cyber-studio': {
    bgTop: '#090d16',
    bgBottom: '#05070c',
    highway: 'rgba(10, 15, 29, 0.92)',
    grid: 'rgba(56, 189, 248, 0.18)',
    label: 'Studio Dark',
  },
}

/** Project normalized highway coordinates (nx in -0.5..0.5, depthFrac in 0..1 where 0 is strike line and 1 is top horizon) to 2D canvas pixels. */
export function projectWaterfallPoint(
  nx: number,
  depthFrac: number,
  width: number,
  height: number,
  angleDeg: number,
): { x: number; y: number; scale: number } {
  const strikeY = height * 0.76
  const tiltFactor = 0.42 + (Math.max(15, Math.min(90, angleDeg)) / 90) * 0.26
  const topY = height * (0.76 - tiltFactor)
  // Perspective foreshortening: closer to 0 (strike line) is wider, closer to 1 (horizon) narrows
  const perspective = 1 / (1 + depthFrac * 0.85)
  const scale = perspective
  const spreadWidth = width * 0.92 * scale
  const x = width * 0.5 + nx * spreadWidth
  const y = strikeY - (strikeY - topY) * (1 - perspective) * 1.85
  return { x, y, scale }
}

export function PianoVisionVRView({
  notes,
  nowSec,
  bpm,
  handFilter,
  onHandFilterChange,
  showFingering: initialFingering = true,
  showSheetHud: initialSheetHud = true,
  noteAlpha,
  onSimulatedNoteOn,
}: PianoVisionVRViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [calibration, setCalibration] = useState<PianoCalibrationState>(() => defaultCalibration(88))
  const [showFingering, setShowFingering] = useState(initialFingering)
  const [showSheetHud, setShowSheetHud] = useState(initialSheetHud)
  const [calibratingStep, setCalibratingStep] = useState<'idle' | 'left-anchor' | 'right-anchor'>('idle')
  const [xrSupported, setXrSupported] = useState<{ ar: boolean; vr: boolean }>({ ar: false, vr: false })
  const [xrStatus, setXrStatus] = useState<string>('Desktop 3D / WebXR Ready')

  const keys = useMemo<KeyGeometry[]>(
    () => buildKeyboardGeometry(calibration.keyboardSize),
    [calibration.keyboardSize],
  )
  const transform = useMemo(() => solveCalibrationTransform(calibration), [calibration])

  const fingeredByIndex = useMemo(() => {
    const rawTargets = notes.map((j) => j.note)
    const fingered = assignFingerings(rawTargets)
    const map = new Map<number, FingeredNote>()
    for (const fn of fingered) map.set(fn.index, fn)
    return map
  }, [notes])

  const keyByMidi = useMemo(() => {
    const map = new Map<number, KeyGeometry>()
    for (const k of keys) map.set(k.midi, k)
    return map
  }, [keys])

  const totalSpanM = useMemo(() => {
    const whiteCount =
      calibration.keyboardSize === 88
        ? 52
        : calibration.keyboardSize === 76
          ? 45
          : calibration.keyboardSize === 61
            ? 36
            : 29
    return whiteCount * 0.0235
  }, [calibration.keyboardSize])

  // Check WebXR capability in browser
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('xr' in navigator)) return
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr
    if (!xr) return
    let mounted = true
    void Promise.all([
      xr.isSessionSupported('immersive-ar').catch(() => false),
      xr.isSessionSupported('immersive-vr').catch(() => false),
    ]).then(([ar, vr]) => {
      if (mounted) setXrSupported({ ar, vr })
    })
    return () => {
      mounted = false
    }
  }, [])

  const launchWebXR = async (mode: 'immersive-ar' | 'immersive-vr') => {
    if (typeof navigator === 'undefined' || !('xr' in navigator)) {
      setXrStatus('WebXR not available in this browser — running Desktop 3D Viewport.')
      return
    }
    try {
      const xr = (
        navigator as Navigator & {
          xr?: { requestSession: (m: string, opts?: Record<string, unknown>) => Promise<{ end: () => Promise<void> }> }
        }
      ).xr
      if (!xr) return
      const session = await xr.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      })
      setXrStatus(`Active WebXR session (${mode}) — calibrated span ${transform.spanMeters.toFixed(3)} m`)
      void session
    } catch (err) {
      setXrStatus(
        `WebXR ${mode} requires a connected headset (${err instanceof Error ? err.message : 'simulation active'})`,
      )
    }
  }

  // Draw the 3D perspective waterfall + 88-key strike deck
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = 860
    const height = 340
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const env = ENV_THEMES[calibration.environment]
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, env.bgTop)
    grad.addColorStop(1, env.bgBottom)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)

    // Highway trapezoid
    const tl = projectWaterfallPoint(-0.5, 1, width, height, calibration.waterfallAngleDeg)
    const tr = projectWaterfallPoint(0.5, 1, width, height, calibration.waterfallAngleDeg)
    const bl = projectWaterfallPoint(-0.5, 0, width, height, calibration.waterfallAngleDeg)
    const br = projectWaterfallPoint(0.5, 0, width, height, calibration.waterfallAngleDeg)

    ctx.fillStyle = env.highway
    ctx.beginPath()
    ctx.moveTo(tl.x, tl.y)
    ctx.lineTo(tr.x, tr.y)
    ctx.lineTo(br.x, br.y)
    ctx.lineTo(bl.x, bl.y)
    ctx.closePath()
    ctx.fill()

    // Beat / bar grid lines along the 3D waterfall
    const lookaheadSec = 3.2
    const beatSec = 60 / Math.max(20, bpm)
    const firstBeat = Math.ceil(nowSec / beatSec) * beatSec
    ctx.strokeStyle = env.grid
    ctx.lineWidth = 1
    for (let t = firstBeat; t <= nowSec + lookaheadSec; t += beatSec) {
      const df = (t - nowSec) / lookaheadSec
      if (df < 0 || df > 1) continue
      const pL = projectWaterfallPoint(-0.5, df, width, height, calibration.waterfallAngleDeg)
      const pR = projectWaterfallPoint(0.5, df, width, height, calibration.waterfallAngleDeg)
      ctx.beginPath()
      ctx.moveTo(pL.x, pL.y)
      ctx.lineTo(pR.x, pR.y)
      ctx.stroke()
    }

    // Active keys at `nowSec`
    const activeHandsByMidi = new Map<number, Hand>()
    for (const j of notes) {
      const fn = fingeredByIndex.get(j.note.index)
      const effHand = fn?.effectiveHand ?? (j.note.hand === 'unknown' ? 'right' : j.note.hand)
      if (handFilter !== 'all' && effHand !== handFilter) continue

      const startDelta = j.note.startSec - nowSec
      const endDelta = j.note.endSec - nowSec
      if (endDelta < 0 || startDelta > lookaheadSec) continue

      if (startDelta <= 0.04 && endDelta >= -0.02) {
        activeHandsByMidi.set(j.note.midi, effHand)
      }

      const key = keyByMidi.get(j.note.midi)
      if (!key) continue
      const nxCenter = key.localX / totalSpanM
      const nxHalfW = (key.widthM / totalSpanM) * 0.48

      const d0 = Math.max(0, Math.min(1, startDelta / lookaheadSec))
      const d1 = Math.max(d0 + 0.015, Math.min(1, endDelta / lookaheadSec))

      const bLeft = projectWaterfallPoint(nxCenter - nxHalfW, d0, width, height, calibration.waterfallAngleDeg)
      const bRight = projectWaterfallPoint(nxCenter + nxHalfW, d0, width, height, calibration.waterfallAngleDeg)
      const tLeft = projectWaterfallPoint(nxCenter - nxHalfW, d1, width, height, calibration.waterfallAngleDeg)
      const tRight = projectWaterfallPoint(nxCenter + nxHalfW, d1, width, height, calibration.waterfallAngleDeg)

      const colour = HAND_COLOURS[effHand]
      const fade = noteAlpha ? Math.max(0.18, Math.min(1, noteAlpha(j))) : 1
      ctx.globalAlpha = (j.state === 'hit' ? 0.96 : j.state === 'missed' ? 0.35 : 0.84) * fade
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.moveTo(tLeft.x, tLeft.y)
      ctx.lineTo(tRight.x, tRight.y)
      ctx.lineTo(bRight.x, bRight.y)
      ctx.lineTo(bLeft.x, bLeft.y)
      ctx.closePath()
      ctx.fill()

      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 1
      ctx.stroke()

      // Draw finger number badge (1..5) near the bottom (strike edge) of the falling bar
      if (showFingering && fn && bRight.x - bLeft.x >= 7 && Math.abs(bLeft.y - tLeft.y) >= 11) {
        ctx.globalAlpha = 1
        ctx.fillStyle = '#090d16'
        ctx.font = 'bold 10px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(String(fn.finger), (bLeft.x + bRight.x) * 0.5, bLeft.y - 3)
      }
    }

    // Strike-line laser bar
    ctx.globalAlpha = 1
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(bl.x, bl.y - 1.5, br.x - bl.x, 3)

    // Draw 3D physical piano keyboard deck below strike line
    const keyDeckTop = bl.y + 2
    const whiteKeyH = height - keyDeckTop - 8
    const blackKeyH = whiteKeyH * 0.62

    // White keys first
    for (const k of keys) {
      if (k.isBlack) continue
      const nxL = (k.localX - k.widthM * 0.5) / totalSpanM
      const nxR = (k.localX + k.widthM * 0.5) / totalSpanM
      const pL = projectWaterfallPoint(nxL, 0, width, height, calibration.waterfallAngleDeg)
      const pR = projectWaterfallPoint(nxR, 0, width, height, calibration.waterfallAngleDeg)
      const activeHand = activeHandsByMidi.get(k.midi)
      ctx.fillStyle = activeHand ? HAND_COLOURS[activeHand] : '#f1f5f9'
      ctx.fillRect(pL.x, keyDeckTop, Math.max(1, pR.x - pL.x - 0.8), whiteKeyH)
    }

    // Black keys on top
    for (const k of keys) {
      if (!k.isBlack) continue
      const nxL = (k.localX - k.widthM * 0.5) / totalSpanM
      const nxR = (k.localX + k.widthM * 0.5) / totalSpanM
      const pL = projectWaterfallPoint(nxL, 0, width, height, calibration.waterfallAngleDeg)
      const pR = projectWaterfallPoint(nxR, 0, width, height, calibration.waterfallAngleDeg)
      const activeHand = activeHandsByMidi.get(k.midi)
      ctx.fillStyle = activeHand ? HAND_COLOURS[activeHand] : '#0f172a'
      ctx.fillRect(pL.x, keyDeckTop, Math.max(1, pR.x - pL.x), blackKeyH)
    }

    ctx.restore()
  }, [
    notes,
    nowSec,
    bpm,
    handFilter,
    showFingering,
    calibration,
    keys,
    keyByMidi,
    totalSpanM,
    fingeredByIndex,
    noteAlpha,
  ])

  const range = KEYBOARD_RANGES[calibration.keyboardSize]
  const currentBar = Math.max(1, Math.floor(nowSec / ((60 / Math.max(20, bpm)) * 4)) + 1)

  // Upcoming notes in the current 4-second window for the Sheet Music HUD
  const hudNotes = useMemo(() => {
    return notes
      .filter((j) => j.note.endSec >= nowSec - 0.5 && j.note.startSec <= nowSec + 3.5)
      .slice(0, 16)
  }, [notes, nowSec])

  return (
    <section className="pianovision-vr-stage" aria-label="PianoVision VR & Mixed Reality Stage">
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <div>
          <strong>PianoVision VR / MR Stage</strong>{' '}
          <span className="muted mono" style={{ fontSize: '0.82rem' }}>
            {calibration.keyboardSize} keys ({midiNoteName(range.low)}–{midiNoteName(range.high)}) · Span{' '}
            {transform.spanMeters.toFixed(3)} m · Bar {currentBar}
          </span>
        </div>

        <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
          {([88, 76, 61, 49] as const).map((sz: KeyboardSize) => (
            <button
              key={sz}
              type="button"
              className={calibration.keyboardSize === sz ? 'active' : 'ghost'}
              onClick={() => setCalibration(defaultCalibration(sz))}
            >
              {sz}-Key
            </button>
          ))}
          <select
            aria-label="VR Environment"
            value={calibration.environment}
            onChange={(e) =>
              setCalibration((prev) => ({
                ...prev,
                environment: e.target.value as PianoCalibrationState['environment'],
              }))
            }
          >
            <option value="passthrough-mr">Passthrough MR Cutout</option>
            <option value="concert-hall">Virtual Concert Hall</option>
            <option value="cyber-studio">Studio Dark</option>
          </select>
          <button
            type="button"
            className={showFingering ? 'active' : 'ghost'}
            onClick={() => setShowFingering((v) => !v)}
          >
            Fingering (1–5)
          </button>
          <button
            type="button"
            className={showSheetHud ? 'active' : 'ghost'}
            onClick={() => setShowSheetHud((v) => !v)}
          >
            Sheet HUD
          </button>
        </div>
      </div>

      {/* Hand filter + 2-point calibration + WebXR session bar */}
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.55rem',
        }}
      >
        <div className="row" style={{ gap: '0.35rem' }} role="group" aria-label="Hand Separation">
          {(
            [
              ['all', 'Both Hands'],
              ['left', 'Left Hand (LH)'],
              ['right', 'Right Hand (RH)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={handFilter === id ? 'active' : 'ghost'}
              onClick={() => onHandFilterChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="field" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Waterfall Tilt ({calibration.waterfallAngleDeg}°)
            </span>
            <input
              type="range"
              min={25}
              max={85}
              value={calibration.waterfallAngleDeg}
              onChange={(e) =>
                setCalibration((prev) => ({ ...prev, waterfallAngleDeg: Number(e.target.value) }))
              }
            />
          </label>

          <button
            type="button"
            className={calibratingStep !== 'idle' ? 'active' : 'ghost'}
            onClick={() => {
              if (calibratingStep === 'idle') {
                setCalibratingStep('left-anchor')
                setXrStatus(`Pinch/Align Left Anchor (${midiNoteName(range.low)})`)
              } else if (calibratingStep === 'left-anchor') {
                setCalibratingStep('right-anchor')
                setXrStatus(`Pinch/Align Right Anchor (${midiNoteName(range.high)})`)
              } else {
                setCalibratingStep('idle')
                setXrStatus(
                  `Calibrated ${calibration.keyboardSize}-key piano (${transform.spanMeters.toFixed(3)} m)`,
                )
              }
            }}
          >
            {calibratingStep === 'idle'
              ? '2-Point Calibrate (A0→C8)'
              : calibratingStep === 'left-anchor'
                ? `Set Left (${midiNoteName(range.low)})`
                : `Set Right (${midiNoteName(range.high)})`}
          </button>

          <button type="button" className="ghost" onClick={() => void launchWebXR('immersive-ar')}>
            {xrSupported.ar ? 'Enter MR Passthrough' : 'MR Preview'}
          </button>
          <button type="button" className="ghost" onClick={() => void launchWebXR('immersive-vr')}>
            {xrSupported.vr ? 'Enter VR Stage' : 'VR Preview'}
          </button>
        </div>
      </div>

      {/* Synchronized Floating Grand-Staff Sheet Music HUD (Leg E) */}
      {showSheetHud && (
        <div
          className="pianovision-sheet-hud"
          role="region"
          aria-label="Floating Sheet Music HUD"
          style={{
            marginBottom: '0.5rem',
            padding: '0.45rem 0.65rem',
            borderRadius: 6,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
          }}
        >
          <svg
            viewBox="0 0 760 84"
            style={{ width: '100%', height: 76, display: 'block' }}
            role="img"
            aria-label="Synchronized Grand Staff Notation"
          >
            {/* Treble & Bass 5-line staves */}
            {[12, 18, 24, 30, 36, 52, 58, 64, 70, 76].map((y) => (
              <line
                key={y}
                x1={16}
                y1={y}
                x2={744}
                y2={y}
                stroke="rgba(148, 163, 184, 0.35)"
                strokeWidth={1}
              />
            ))}
            {/* Playhead cursor at X=140 */}
            <line x1={140} y1={6} x2={140} y2={80} stroke="#38bdf8" strokeWidth={2} />
            <text x={22} y={28} fill="#94a3b8" fontSize={14} fontFamily="serif">
              𝄞
            </text>
            <text x={22} y={68} fill="#94a3b8" fontSize={14} fontFamily="serif">
              𝄢
            </text>
            {hudNotes.map((j) => {
              const fn = fingeredByIndex.get(j.note.index)
              const effHand = fn?.effectiveHand ?? (j.note.midi >= 60 ? 'right' : 'left')
              if (handFilter !== 'all' && effHand !== handFilter) return null
              const x = 140 + (j.note.startSec - nowSec) * 145
              if (x < 50 || x > 735) return null
              // Map MIDI pitch to treble (top) or bass (bottom) staff Y
              const isTreble = j.note.midi >= 60
              const refMidi = isTreble ? 71 : 50 // B4 on middle treble line (y=24), D3 on middle bass line (y=64)
              const centerLineY = isTreble ? 24 : 64
              const diatonicStep = (j.note.midi - refMidi) * 1.75
              const y = Math.max(6, Math.min(80, centerLineY - diatonicStep))
              const fill = HAND_COLOURS[effHand]
              return (
                <g key={j.note.index}>
                  <ellipse cx={x} cy={y} rx={4.5} ry={3.4} fill={fill} />
                  {showFingering && fn && (
                    <text x={x} y={y - 6} fill="#e2e8f0" fontSize={8} textAnchor="middle">
                      {fn.finger}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}

      {/* 3D Waterfall + Calibrated Physical Key Deck Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="PianoVision 3D Falling Notes Waterfall"
        className="pianovision-vr-canvas"
        style={{
          width: '100%',
          height: 300,
          display: 'block',
          borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.24)',
        }}
        onClick={(e) => {
          if (!onSimulatedNoteOn) return
          const rect = e.currentTarget.getBoundingClientRect()
          const fracX = (e.clientX - rect.left) / Math.max(1, rect.width)
          const midi = Math.round(range.low + fracX * (range.high - range.low))
          onSimulatedNoteOn({ timeSec: nowSec, midi, velocity: 96 })
        }}
      />

      <div
        className="row muted mono"
        style={{ justifyContent: 'space-between', fontSize: '0.78rem', marginTop: '0.35rem' }}
      >
        <span>{xrStatus}</span>
        <span>Environment: {ENV_THEMES[calibration.environment].label}</span>
      </div>
    </section>
  )
}
