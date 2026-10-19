/**
 * Preview pitch detection (tuner readout).
 *
 * Autocorrelation over a short window of the decoded source. It is deliberately a
 * preview: it is monophonic-biased and will pick a harmonic on dense mixes. The UI
 * labels the reading and never claims studio-grade tuning.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface PitchReading {
  hz: number
  note: string
  octave: number
  midi: number
  cents: number
}

function rms(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, samples.length))
}

/**
 * Return the fundamental in Hz, or null for silence/noise.
 * `minHz`/`maxHz` bound the search (default 50–1500 Hz, a vocal/instrument range).
 */
export function detectPitchHz(
  samples: ArrayLike<number>,
  sampleRate: number,
  minHz = 50,
  maxHz = 1500,
): number | null {
  const n = Math.min(samples.length, 4096)
  if (n < 256 || sampleRate <= 0) return null
  if (rms(samples) < 0.004) return null

  let mean = 0
  for (let i = 0; i < n; i += 1) mean += samples[i]
  mean /= n
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i += 1) buf[i] = samples[i] - mean

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz))
  if (maxLag <= minLag + 2) return null

  const corr = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0
    let e1 = 0
    let e2 = 0
    const limit = n - lag
    for (let i = 0; i < limit; i += 1) {
      const a = buf[i]
      const b = buf[i + lag]
      dot += a * b
      e1 += a * a
      e2 += b * b
    }
    corr[lag] = dot / Math.sqrt(e1 * e2 + 1e-12)
  }

  // First strong peak wins, which avoids the common octave-below error.
  let bestLag = -1
  let bestValue = 0
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const value = corr[lag]
    if (value > corr[lag - 1] && value >= corr[lag + 1] && value > 0.3) {
      bestLag = lag
      bestValue = value
      break
    }
  }
  if (bestLag < 0) {
    for (let lag = minLag + 1; lag < maxLag; lag += 1) {
      if (corr[lag] > bestValue) {
        bestValue = corr[lag]
        bestLag = lag
      }
    }
  }
  if (bestLag <= 0 || bestValue < 0.3) return null

  // Parabolic interpolation around the peak for sub-sample precision.
  const left = corr[bestLag - 1]
  const right = corr[bestLag + 1]
  const denom = left - 2 * corr[bestLag] + right
  const shift = Math.abs(denom) > 1e-9 ? (0.5 * (left - right)) / denom : 0
  const refined = bestLag + Math.max(-0.5, Math.min(0.5, shift))
  const hz = sampleRate / refined
  if (!Number.isFinite(hz) || hz < minHz * 0.8 || hz > maxHz * 1.2) return null
  return hz
}

export function nearestNote(hz: number): PitchReading | null {
  if (!Number.isFinite(hz) || hz <= 0) return null
  const midiFloat = 69 + 12 * Math.log2(hz / 440)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  return {
    hz,
    note: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents,
  }
}

export function pitchAt(
  channels: Float32Array[],
  sampleRate: number,
  startSample: number,
  windowSeconds = 0.06,
): PitchReading | null {
  const data = channels[0]
  if (!data) return null
  const width = Math.max(512, Math.floor(windowSeconds * sampleRate))
  const start = Math.max(0, Math.min(startSample, data.length - width))
  if (start < 0) return null
  const slice = data.subarray(start, start + width)
  const hz = detectPitchHz(slice, sampleRate)
  return hz == null ? null : nearestNote(hz)
}
