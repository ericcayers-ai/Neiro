/**
 * PianoVision adoption Leg G — Acoustic Piano Microphone Pitch Detection (YIN).
 *
 * Pure TypeScript: no DOM, no window, no MediaStream, no timers.
 * Mirrors `src/neiro/dsp_transcriber.py:17` (`_yin_f0`) on a single PCM frame
 * from an AudioContext / AudioWorklet / AnalyserNode, plus a stateful onset
 * tracker (`AcousticNoteDetector`) that emits `ObservedNote` events with
 * configurable acoustic latency compensation (`latencyOffsetMs`) so an
 * acoustic piano without USB-MIDI can drive PianoVision wait gates and scoring.
 */

import type { ObservedNote } from './engine'

export interface YinEstimate {
  /** Fundamental frequency in Hz, or null when unvoiced / silent. */
  f0Hz: number | null
  /** Nearest MIDI note number (21..108 for piano), or null when unvoiced. */
  midi: number | null
  /** Deviation from equal-tempered 440 Hz MIDI pitch in cents (-50..+50). */
  cents: number
  /** Confidence in 0..1 (1 - CMNDF minimum). */
  confidence: number
  /** RMS amplitude of the analyzed buffer. */
  rms: number
}

export interface YinOptions {
  sampleRate: number
  /** Minimum detectable frequency in Hz (default 27.5 Hz = A0). */
  fminHz?: number
  /** Maximum detectable frequency in Hz (default 4186.0 Hz = C8). */
  fmaxHz?: number
  /** CMNDF threshold (default 0.15; lower is stricter). */
  threshold?: number
  /** Minimum RMS gate before attempting pitch detection (default 0.008). */
  rmsGate?: number
  /** Concert pitch reference A4 in Hz (default 440). */
  a4Hz?: number
}

/** Convert frequency in Hz to fractional MIDI pitch. */
export function hzToMidiFloat(hz: number, a4Hz: number = 440): number {
  return 69 + 12 * Math.log2(hz / a4Hz)
}

/** Convert MIDI note number to frequency in Hz. */
export function midiToHz(midi: number, a4Hz: number = 440): number {
  return a4Hz * Math.pow(2, (midi - 69) / 12)
}

/**
 * Estimate fundamental frequency f0 on a single mono PCM frame using the
 * Cumulative Mean Normalized Difference Function (CMNDF) YIN algorithm
 * with parabolic interpolation around the first sub-threshold dip.
 */
export function detectYinPitch(samples: ArrayLike<number>, options: YinOptions): YinEstimate {
  const n = samples.length
  const sr = options.sampleRate
  const fmin = options.fminHz ?? 27.5
  const fmax = options.fmaxHz ?? 4186.0
  const threshold = options.threshold ?? 0.15
  const rmsGate = options.rmsGate ?? 0.008
  const a4 = options.a4Hz ?? 440

  if (n < 32 || !Number.isFinite(sr) || sr <= 0) {
    return { f0Hz: null, midi: null, cents: 0, confidence: 0, rms: 0 }
  }

  let sumSq = 0
  for (let i = 0; i < n; i += 1) {
    const v = samples[i]
    sumSq += v * v
  }
  const rms = Math.sqrt(sumSq / n)
  if (rms < rmsGate) {
    return { f0Hz: null, midi: null, cents: 0, confidence: 0, rms }
  }

  const tauMin = Math.max(2, Math.floor(sr / fmax))
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sr / fmin))
  if (tauMax <= tauMin) {
    return { f0Hz: null, midi: null, cents: 0, confidence: 0, rms }
  }

  const diff = new Float64Array(tauMax + 1)
  const cmndf = new Float64Array(tauMax + 1)
  cmndf[0] = 1

  const windowSize = n - tauMax
  let runningSum = 0

  for (let tau = 1; tau <= tauMax; tau += 1) {
    let d = 0
    for (let i = 0; i < windowSize; i += 1) {
      const delta = samples[i] - samples[i + tau]
      d += delta * delta
    }
    diff[tau] = d
    runningSum += d
    cmndf[tau] = runningSum > 1e-12 ? (d * tau) / runningSum : 1
  }

  // Find first local minimum below threshold in [tauMin, tauMax]
  let bestTau = -1
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 <= tauMax && cmndf[tau + 1] < cmndf[tau]) {
        tau += 1
      }
      bestTau = tau
      break
    }
  }

  // Fallback to global minimum if it is reasonably periodic (< 0.35)
  if (bestTau < 0) {
    let minVal = Number.POSITIVE_INFINITY
    let minIdx = -1
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau]
        minIdx = tau
      }
    }
    if (minIdx >= tauMin && minVal < 0.35) {
      bestTau = minIdx
    } else {
      return { f0Hz: null, midi: null, cents: 0, confidence: 0, rms }
    }
  }

  // Parabolic refinement around bestTau
  let refinedTau = bestTau
  if (bestTau > 1 && bestTau < tauMax) {
    const s0 = cmndf[bestTau - 1]
    const s1 = cmndf[bestTau]
    const s2 = cmndf[bestTau + 1]
    const denom = 2 * (2 * s1 - s2 - s0)
    if (Math.abs(denom) > 1e-12) {
      refinedTau = bestTau + (s2 - s0) / denom
    }
  }

  const f0Hz = sr / refinedTau
  const midiFloat = hzToMidiFloat(f0Hz, a4)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  const confidence = Math.max(0, Math.min(1, 1 - cmndf[bestTau]))

  if (midi < 21 || midi > 108) {
    return { f0Hz: null, midi: null, cents: 0, confidence: 0, rms }
  }

  return { f0Hz, midi, cents, confidence, rms }
}

export interface AcousticTrackerOptions extends YinOptions {
  /** Acoustic input latency compensation in milliseconds (subtracted from transport timeSec). */
  latencyOffsetMs?: number
  /** Consecutive matching frames required to confirm a note onset (default 2). */
  confirmFrames?: number
  /** Minimum inter-onset re-trigger time for the same pitch in seconds (default 0.12s). */
  retriggerSec?: number
}

/**
 * Stateful frame-by-frame acoustic note onset detector.
 * Converts continuous YIN frame estimates into discrete `ObservedNote` note-on events
 * compatible with `matchEvents` and `waitGate`.
 */
export class AcousticNoteDetector {
  private candidateMidi: number | null = null
  private candidateFrames = 0
  private activeMidi: number | null = null
  private prevRms = 0
  private lastEmitSecByMidi = new Map<number, number>()

  processFrame(
    samples: ArrayLike<number>,
    transportTimeSec: number,
    options: AcousticTrackerOptions,
  ): { estimate: YinEstimate; emitted: ObservedNote | null } {
    const estimate = detectYinPitch(samples, options)
    const confirmFrames = Math.max(1, options.confirmFrames ?? 2)
    const latencySec = (options.latencyOffsetMs ?? 35) / 1000
    const retriggerSec = options.retriggerSec ?? 0.12

    if (estimate.midi == null) {
      this.candidateMidi = null
      this.candidateFrames = 0
      this.activeMidi = null
      this.prevRms = estimate.rms
      return { estimate, emitted: null }
    }

    const rmsJump = estimate.rms > this.prevRms * 1.45 && estimate.rms > (options.rmsGate ?? 0.008) * 1.8

    if (estimate.midi === this.candidateMidi) {
      this.candidateFrames += 1
    } else {
      this.candidateMidi = estimate.midi
      this.candidateFrames = 1
    }

    let emitted: ObservedNote | null = null
    const isNewPitch = estimate.midi !== this.activeMidi
    const isRetrigger = estimate.midi === this.activeMidi && rmsJump

    if (this.candidateFrames >= confirmFrames && (isNewPitch || isRetrigger)) {
      const compensatedSec = Math.max(0, transportTimeSec - latencySec)
      const prevEmit = this.lastEmitSecByMidi.get(estimate.midi) ?? Number.NEGATIVE_INFINITY
      if (compensatedSec - prevEmit >= retriggerSec) {
        const velocity = Math.max(20, Math.min(127, Math.round(estimate.rms * 360)))
        emitted = {
          timeSec: compensatedSec,
          midi: estimate.midi,
          velocity,
        }
        this.activeMidi = estimate.midi
        this.lastEmitSecByMidi.set(estimate.midi, compensatedSec)
      }
    }

    this.prevRms = estimate.rms
    return { estimate, emitted }
  }

  reset(): void {
    this.candidateMidi = null
    this.candidateFrames = 0
    this.activeMidi = null
    this.prevRms = 0
    this.lastEmitSecByMidi.clear()
  }
}
