import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildKeyboardGeometry,
  defaultCalibration,
  isBlackKey,
  midiNoteName,
  pianoToWorld,
  solveCalibrationTransform,
  waterfallNoteLocalPosition,
  WHITE_KEY_WIDTH_M,
} from './vrCalibration'
import { assignFingerings } from './fingering'
import { AcousticNoteDetector, detectYinPitch, midiToHz } from './acousticPitch'
import { matchEvents, parseTarget } from './engine'
import { PianoVisionVRView, projectWaterfallPoint } from './PianoVisionVRView'

describe('PianoVision VR Calibration & Geometry', () => {
  it('builds exact 88/76/61/49-key physical layouts with 52 white keys on 88-key', () => {
    const keys88 = buildKeyboardGeometry(88)
    expect(keys88).toHaveLength(88)
    expect(keys88[0].midi).toBe(21)
    expect(keys88[0].name).toBe('A0')
    expect(keys88[87].midi).toBe(108)
    expect(keys88[87].name).toBe('C8')

    const whites = keys88.filter((k) => !k.isBlack)
    const blacks = keys88.filter((k) => k.isBlack)
    expect(whites).toHaveLength(52)
    expect(blacks).toHaveLength(36)

    // Monotonically increasing X across all 88 keys
    for (let i = 1; i < keys88.length; i += 1) {
      expect(keys88[i].localX).toBeGreaterThan(keys88[i - 1].localX)
    }

    expect(buildKeyboardGeometry(76)).toHaveLength(76)
    expect(buildKeyboardGeometry(61)).toHaveLength(61)
    expect(buildKeyboardGeometry(49)).toHaveLength(49)
  })

  it('solves 2-point A0->C8 spatial calibration transform and maps local to world coordinates', () => {
    const cal = defaultCalibration(88)
    const tf = solveCalibrationTransform(cal)
    expect(tf.spanMeters).toBeCloseTo(52 * WHITE_KEY_WIDTH_M, 4)
    expect(tf.scale).toBeCloseTo(1.0, 4)
    expect(tf.center.y).toBeCloseTo(-0.25, 4)
    expect(tf.center.z).toBeCloseTo(-0.55, 4)

    const originWorld = pianoToWorld({ x: 0, y: 0, z: 0 }, tf)
    expect(originWorld.x).toBeCloseTo(tf.center.x, 4)
    expect(originWorld.y).toBeCloseTo(tf.center.y, 4)
    expect(originWorld.z).toBeCloseTo(tf.center.z, 4)

    const notePos = waterfallNoteLocalPosition(0.12, 1.5, 60, 0.3)
    expect(notePos.x).toBeCloseTo(0.12, 4)
    expect(notePos.y).toBeGreaterThan(0.3)
    expect(notePos.z).toBeLessThan(-0.15)
  })

  it('identifies black vs white keys and note names accurately', () => {
    expect(isBlackKey(60)).toBe(false) // C4
    expect(isBlackKey(61)).toBe(true)  // C#4
    expect(midiNoteName(60)).toBe('C4')
    expect(midiNoteName(69)).toBe('A4')
  })
})

describe('PianoVision Ergonomic Fingering (Leg E)', () => {
  it('assigns thumb-under and chord fingerings (1..5) for right and left hands', () => {
    const target = parseTarget({
      right: [
        { onset: 0.0, offset: 0.4, pitch: 60, velocity: 90, channel: 0 },
        { onset: 0.5, offset: 0.9, pitch: 62, velocity: 90, channel: 0 },
        { onset: 1.0, offset: 1.4, pitch: 64, velocity: 90, channel: 0 },
        { onset: 1.5, offset: 1.9, pitch: 65, velocity: 90, channel: 0 },
        { onset: 2.0, offset: 2.4, pitch: 67, velocity: 90, channel: 0 },
      ],
      left: [
        // C major triad in LH
        { onset: 0.0, offset: 1.0, pitch: 48, velocity: 85, channel: 1 },
        { onset: 0.01, offset: 1.0, pitch: 52, velocity: 85, channel: 1 },
        { onset: 0.02, offset: 1.0, pitch: 55, velocity: 85, channel: 1 },
      ],
    })

    const fingered = assignFingerings(target)
    expect(fingered).toHaveLength(8)
    for (const f of fingered) {
      expect(f.finger).toBeGreaterThanOrEqual(1)
      expect(f.finger).toBeLessThanOrEqual(5)
    }

    const lhChord = fingered.filter((f) => f.effectiveHand === 'left')
    expect(lhChord.map((f) => f.finger)).toEqual([5, 3, 1])
  })
})

describe('PianoVision Acoustic Piano Pitch Detection (Leg G — YIN)', () => {
  function synthSine(freqHz: number, sampleRate: number, length: number, amp = 0.25): Float32Array {
    const buf = new Float32Array(length)
    for (let i = 0; i < length; i += 1) {
      buf[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
    }
    return buf
  }

  it('detects A4 (440 Hz -> MIDI 69) and C4 (261.63 Hz -> MIDI 60) with high confidence', () => {
    const sr = 44100
    const a4 = detectYinPitch(synthSine(440, sr, 2048), { sampleRate: sr })
    expect(a4.midi).toBe(69)
    expect(a4.f0Hz).not.toBeNull()
    expect(a4.f0Hz!).toBeCloseTo(440, 0)
    expect(a4.confidence).toBeGreaterThan(0.85)

    const c4Hz = midiToHz(60)
    const c4 = detectYinPitch(synthSine(c4Hz, sr, 2048), { sampleRate: sr })
    expect(c4.midi).toBe(60)
    expect(Math.abs(c4.cents)).toBeLessThanOrEqual(5)
  })

  it('emits latency-compensated ObservedNote events across consecutive frames', () => {
    const sr = 44100
    const detector = new AcousticNoteDetector()
    const frame = synthSine(midiToHz(64), sr, 2048, 0.2) // E4

    const r1 = detector.processFrame(frame, 1.0, {
      sampleRate: sr,
      confirmFrames: 2,
      latencyOffsetMs: 40,
    })
    expect(r1.emitted).toBeNull()

    const r2 = detector.processFrame(frame, 1.05, {
      sampleRate: sr,
      confirmFrames: 2,
      latencyOffsetMs: 40,
    })
    expect(r2.emitted).not.toBeNull()
    expect(r2.emitted!.midi).toBe(64)
    expect(r2.emitted!.timeSec).toBeCloseTo(1.05 - 0.04, 4)
  })
})

describe('PianoVisionVRView SSR & Waterfall Projection', () => {
  it('renders SSR static markup with 88-key calibration, hand separation, and Sheet Music HUD', () => {
    const target = parseTarget({
      right: [{ onset: 0.5, offset: 1.2, pitch: 60, velocity: 96, channel: 0 }],
      left: [{ onset: 0.5, offset: 1.2, pitch: 48, velocity: 88, channel: 1 }],
    })
    const judged = matchEvents(target, [], { atSec: 0 }).notes

    const html = renderToStaticMarkup(
      <PianoVisionVRView
        notes={judged}
        nowSec={0.2}
        bpm={120}
        handFilter="all"
        showFingering
        showSheetHud
      />,
    )

    expect(html).toContain('PianoVision VR / MR Stage')
    expect(html).toContain('88-Key')
    expect(html).toContain('Floating Sheet Music HUD')
    expect(html).toContain('2-Point Calibrate (A0→C8)')
  })

  it('projects waterfall points with foreshortening from horizon to strike line', () => {
    const strike = projectWaterfallPoint(0.25, 0, 800, 300, 68)
    const horizon = projectWaterfallPoint(0.25, 1, 800, 300, 68)
    expect(strike.y).toBeGreaterThan(horizon.y)
    expect(strike.scale).toBeGreaterThan(horizon.scale)
  })
})
