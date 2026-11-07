/**
 * PianoVision VR / MR Spatial Calibration & Physical Keyboard Geometry.
 *
 * Pure TypeScript: no DOM, no window, no timers.
 * Generates exact physical key dimensions (49/61/76/88-key pianos, A0..C8),
 * solves the 2-point spatial anchor transform (leftmost key A0 -> rightmost key C8)
 * in 3D space (WebXR meters), and computes perspective projection for both desktop
 * 3D preview and stereoscopic WebXR left/right eye views.
 */

export type KeyboardSize = 88 | 76 | 61 | 49

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface KeyGeometry {
  midi: number
  name: string
  isBlack: boolean
  /** Center X in local piano frame (meters, origin at keyboard center). */
  localX: number
  /** Center Y in local piano frame (meters, white keys = 0, black keys elevated +0.011m). */
  localY: number
  /** Center Z in local piano frame (meters, along key length toward fallboard). */
  localZ: number
  widthM: number
  heightM: number
  depthM: number
}

export interface PianoCalibrationState {
  keyboardSize: KeyboardSize
  /** World-space position of the leftmost key's front-center edge (meters). */
  leftAnchor: Vec3
  /** World-space position of the rightmost key's front-center edge (meters). */
  rightAnchor: Vec3
  /** Pitch tilt of the waterfall plane in degrees (0 = horizontal, 65 = angled up, 90 = vertical). */
  waterfallAngleDeg: number
  /** Environment mode: passthrough MR cutout vs virtual concert hall vs studio. */
  environment: 'passthrough-mr' | 'concert-hall' | 'cyber-studio'
}

/** Standard concert piano measurements in meters. */
export const WHITE_KEY_WIDTH_M = 0.0235
export const WHITE_KEY_DEPTH_M = 0.15
export const WHITE_KEY_HEIGHT_M = 0.022
export const BLACK_KEY_WIDTH_M = 0.0137
export const BLACK_KEY_DEPTH_M = 0.095
export const BLACK_KEY_HEIGHT_M = 0.014
export const BLACK_KEY_ELEVATION_M = 0.011

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10])

/** Pitch ranges (inclusive MIDI numbers) for standard keyboard sizes. */
export const KEYBOARD_RANGES: Record<KeyboardSize, { low: number; high: number }> = {
  88: { low: 21, high: 108 }, // A0 .. C8
  76: { low: 28, high: 103 }, // E1 .. G7
  61: { low: 36, high: 96 },  // C2 .. C7
  49: { low: 36, high: 84 },  // C2 .. C6
}

export function isBlackKey(midi: number): boolean {
  const semitone = ((Math.round(midi) % 12) + 12) % 12
  return BLACK_SEMITONES.has(semitone)
}

export function midiNoteName(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)))
  const name = NOTE_NAMES[clamped % 12]
  const octave = Math.floor(clamped / 12) - 1
  return `${name}${octave}`
}

/**
 * Build the physical 3D key layout for an 88/76/61/49-key keyboard.
 * Local coordinates have X running left-to-right across the keys (centered at 0),
 * Y pointing up, and Z pointing away from the pianist into the fallboard (-Z).
 */
export function buildKeyboardGeometry(size: KeyboardSize = 88): KeyGeometry[] {
  const range = KEYBOARD_RANGES[size] ?? KEYBOARD_RANGES[88]
  const whitePitches: number[] = []
  for (let m = range.low; m <= range.high; m += 1) {
    if (!isBlackKey(m)) whitePitches.push(m)
  }

  const totalWidth = whitePitches.length * WHITE_KEY_WIDTH_M
  const leftEdge = -totalWidth / 2

  const whiteIndexByMidi = new Map<number, number>()
  whitePitches.forEach((m, idx) => whiteIndexByMidi.set(m, idx))

  const keys: KeyGeometry[] = []
  for (let m = range.low; m <= range.high; m += 1) {
    const black = isBlackKey(m)
    if (!black) {
      const idx = whiteIndexByMidi.get(m) ?? 0
      const localX = leftEdge + (idx + 0.5) * WHITE_KEY_WIDTH_M
      keys.push({
        midi: m,
        name: midiNoteName(m),
        isBlack: false,
        localX,
        localY: 0,
        localZ: -WHITE_KEY_DEPTH_M / 2,
        widthM: WHITE_KEY_WIDTH_M * 0.96,
        heightM: WHITE_KEY_HEIGHT_M,
        depthM: WHITE_KEY_DEPTH_M,
      })
    } else {
      // A black key sits between its lower white neighbor (m - 1) and upper white neighbor (m + 1)
      const lowerWhiteIdx = whiteIndexByMidi.get(m - 1)
      const upperWhiteIdx = whiteIndexByMidi.get(m + 1)
      const baseIdx =
        lowerWhiteIdx !== undefined
          ? lowerWhiteIdx + 1
          : upperWhiteIdx !== undefined
            ? upperWhiteIdx
            : 0
      const localX = leftEdge + baseIdx * WHITE_KEY_WIDTH_M
      keys.push({
        midi: m,
        name: midiNoteName(m),
        isBlack: true,
        localX,
        localY: BLACK_KEY_ELEVATION_M,
        localZ: -(WHITE_KEY_DEPTH_M - BLACK_KEY_DEPTH_M / 2),
        widthM: BLACK_KEY_WIDTH_M,
        heightM: BLACK_KEY_HEIGHT_M,
        depthM: BLACK_KEY_DEPTH_M,
      })
    }
  }
  return keys
}

export interface SpatialTransform {
  center: Vec3
  /** Unit right vector (+X along keyboard from bass to treble). */
  right: Vec3
  /** Unit up vector (+Y normal to keys). */
  up: Vec3
  /** Unit forward vector (-Z away from player toward fallboard). */
  forward: Vec3
  /** Uniform scale factor matching physical span to anchor distance. */
  scale: number
  /** Measured span in meters between left and right anchors. */
  spanMeters: number
}

/**
 * Default desk/stand calibration in WebXR standing/seated coordinates:
 * Keyboard centered in front of the player at Y = -0.25m, Z = -0.55m, span = 1.222m (52 white keys).
 */
export function defaultCalibration(size: KeyboardSize = 88): PianoCalibrationState {
  const whiteCount = size === 88 ? 52 : size === 76 ? 45 : size === 61 ? 36 : 29
  const halfSpan = (whiteCount * WHITE_KEY_WIDTH_M) / 2
  return {
    keyboardSize: size,
    leftAnchor: { x: -halfSpan, y: -0.25, z: -0.55 },
    rightAnchor: { x: halfSpan, y: -0.25, z: -0.55 },
    waterfallAngleDeg: 68,
    environment: 'passthrough-mr',
  }
}

/**
 * Solve the 3D rigid + uniform-scale transform from the 2-point calibration anchors
 * (PianoVision's two-pinch / controller alignment of leftmost and rightmost keys).
 */
export function solveCalibrationTransform(state: PianoCalibrationState): SpatialTransform {
  const dx = state.rightAnchor.x - state.leftAnchor.x
  const dy = state.rightAnchor.y - state.leftAnchor.y
  const dz = state.rightAnchor.z - state.leftAnchor.z
  const dist = Math.hypot(dx, dy, dz)

  const whiteCount =
    state.keyboardSize === 88
      ? 52
      : state.keyboardSize === 76
        ? 45
        : state.keyboardSize === 61
          ? 36
          : 29
  const nominalSpan = whiteCount * WHITE_KEY_WIDTH_M
  const spanMeters = dist > 0.1 ? dist : nominalSpan
  const scale = spanMeters / nominalSpan

  const right: Vec3 =
    dist > 1e-5
      ? { x: dx / dist, y: dy / dist, z: dz / dist }
      : { x: 1, y: 0, z: 0 }

  // World up reference (0, 1, 0); forward = cross(up_world, right) normalized
  const fx = -right.z
  const fy = 0
  const fz = right.x
  const fLen = Math.hypot(fx, fy, fz) || 1
  const forward: Vec3 = { x: fx / fLen, y: fy / fLen, z: fz / fLen }

  // Orthogonal up = cross(right, forward)
  const up: Vec3 = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  }

  const center: Vec3 = {
    x: (state.leftAnchor.x + state.rightAnchor.x) * 0.5,
    y: (state.leftAnchor.y + state.rightAnchor.y) * 0.5,
    z: (state.leftAnchor.z + state.rightAnchor.z) * 0.5,
  }

  return { center, right, up, forward, scale, spanMeters }
}

/** Transform a local piano-space point into calibrated 3D world space. */
export function pianoToWorld(local: Vec3, transform: SpatialTransform): Vec3 {
  const sx = local.x * transform.scale
  const sy = local.y * transform.scale
  const sz = local.z * transform.scale
  return {
    x:
      transform.center.x +
      transform.right.x * sx +
      transform.up.x * sy -
      transform.forward.x * sz,
    y:
      transform.center.y +
      transform.right.y * sx +
      transform.up.y * sy -
      transform.forward.y * sz,
    z:
      transform.center.z +
      transform.right.z * sx +
      transform.up.z * sy -
      transform.forward.z * sz,
  }
}

/**
 * Compute where a falling note at `deltaSec` ahead of `nowSec` sits in local piano coordinates
 * before world transformation.
 * - `deltaSec == 0` lands directly on the strike line at the back of the key (`z = -WHITE_KEY_DEPTH_M`, `y = 0`).
 * - `deltaSec > 0` extends up the inclined waterfall highway at `waterfallAngleDeg`.
 */
export function waterfallNoteLocalPosition(
  keyLocalX: number,
  deltaSec: number,
  waterfallAngleDeg: number,
  metersPerSecond: number = 0.28,
): Vec3 {
  const distanceM = Math.max(0, deltaSec) * metersPerSecond
  const rad = (Math.max(0, Math.min(90, waterfallAngleDeg)) * Math.PI) / 180
  return {
    x: keyLocalX,
    y: Math.sin(rad) * distanceM,
    z: -WHITE_KEY_DEPTH_M - Math.cos(rad) * distanceM,
  }
}
