/**
 * Neiro Companion — streaming pitch shifter for tab audio.
 *
 * Clean-room granular shifter: a ring buffer feeds two overlapping grains whose
 * read positions advance at the pitch ratio and cross-fade. It is a preview-grade
 * shifter (formants follow the pitch); the desktop app's phase-vocoder player and
 * the Python engine's rendered jobs are the higher-quality paths.
 *
 * Plain ESM so Node can import the kernel for tests.
 */

const TWO_PI = Math.PI * 2

export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

export function pitchRatioForSemitones(semitones, cents = 0) {
  return Math.pow(2, (semitones + cents / 100) / 12)
}

export class GrainShifter {
  constructor(sampleRate, grain = 2048, ringSeconds = 2) {
    this.sampleRate = sampleRate
    this.grain = grain
    this.ringSize = Math.max(grain * 4, Math.round(sampleRate * ringSeconds))
    this.ring = new Float32Array(this.ringSize)
    this.write = 0
    this.read = 0
    this.phase = 0
    this.ratio = 1
    this.bypass = false
  }

  setPitch(ratio) {
    this.ratio = clamp(ratio, 0.25, 4)
  }

  push(sample) {
    this.ring[this.write] = sample
    this.write = (this.write + 1) % this.ringSize
    if (this.read === this.write) this.read = (this.read + 1) % this.ringSize
  }

  _at(index) {
    // Linear interpolation between ring taps: nearest-neighbour reads at
    // fractional delays are audible as aliasing on the shifted signal.
    const base = Math.floor(index)
    const frac = index - base
    const i0 = ((base % this.ringSize) + this.ringSize) % this.ringSize
    const i1 = (i0 + 1) % this.ringSize
    return this.ring[i0] * (1 - frac) + this.ring[i1] * frac
  }

  /** Pull one shifted sample from two delay taps, cross-faded with triangles. */
  next() {
    if (this.bypass || Math.abs(this.ratio - 1) < 1e-4) {
      return this._at(this.write - 1)
    }
    const window = this.grain
    // For pitch up the tap delay ramps down (the read head outruns the write
    // head); for pitch down it ramps up. Two taps half a window apart cross-fade
    // with complementary triangles, hiding the wrap.
    this.phase = (this.phase - (this.ratio - 1) + window) % window
    const p1 = this.phase
    const p2 = (this.phase + window / 2) % window
    const w1 = 1 - Math.abs((2 * p1) / window - 1)
    const w2 = 1 - w1
    return this._at(this.write - p1) * w1 + this._at(this.write - p2) * w2
  }
}

const ProcessorBase =
  typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {}

class CaptureProcessor extends ProcessorBase {
  constructor() {
    super()
    this.shifterL = null
    this.shifterR = null
    this.bypass = false
    this.port.onmessage = (event) => {
      const message = event.data || {}
      if (message.type === 'pitch') {
        const ratio = pitchRatioForSemitones(message.semitones || 0, message.cents || 0)
        if (this.shifterL) this.shifterL.setPitch(ratio)
        if (this.shifterR) this.shifterR.setPitch(ratio)
      } else if (message.type === 'bypass') {
        this.bypass = Boolean(message.value)
        if (this.shifterL) this.shifterL.bypass = this.bypass
        if (this.shifterR) this.shifterR.bypass = this.bypass
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !input.length) {
      for (const channel of output) channel.fill(0)
      return true
    }
    const frames = output[0].length
    const sr = sampleRate
    if (!this.shifterL) {
      this.shifterL = new GrainShifter(sr)
      this.shifterR = new GrainShifter(sr)
      this.shifterL.bypass = this.bypass
      this.shifterR.bypass = this.bypass
    }
    const left = input[0]
    const right = input[1] || input[0]
    for (let i = 0; i < frames; i += 1) {
      this.shifterL.push(left[i] || 0)
      this.shifterR.push(right[i] || 0)
      output[0][i] = this.shifterL.next()
      if (output[1]) output[1][i] = this.shifterR.next()
    }
    return true
  }
}

export { CaptureProcessor }

if (typeof registerProcessor === 'function') {
  registerProcessor('neiro-capture', CaptureProcessor)
}
