/**
 * Neiro player worklet — clean-room preview DSP.
 *
 * Plain ESM JavaScript (no imports, no build step) so `audioWorklet.addModule()`
 * can load it directly and Node can unit-test the kernels without a browser.
 *
 * Pipeline (per sample): WSOLA time-stretch (speed) -> linear resample (pitch) ->
 * optional cepstral formant warp -> 6-band EQ -> vocal reducer -> gain.
 *
 * Nothing here is copied from another player. The stretcher is overlap-add WSOLA
 * with a decimated similarity search, the resampler is linear interpolation, and
 * the formant stage is a cepstral envelope warp. This is a *preview*: the Python
 * engine remains the rendered-quality path and the UI labels the method.
 */

const TWO_PI = Math.PI * 2

function hann(size) {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i += 1) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / size)
  return w
}

export function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value
}

export function dbToGain(db) {
  return Math.pow(10, db / 20)
}

export function semitonesToRatio(semitones, cents = 0) {
  return Math.pow(2, (semitones + cents / 100) / 12)
}

/* ------------------------------------------------------------------ FFT ---- */

export class Fft {
  constructor(size) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.size = size
    this.rev = new Uint32Array(size)
    let bits = 0
    while (1 << bits < size) bits += 1
    for (let i = 0; i < size; i += 1) {
      let r = 0
      for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float32Array(size / 2)
    this.sin = new Float32Array(size / 2)
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((TWO_PI * i) / size)
      this.sin[i] = -Math.sin((TWO_PI * i) / size)
    }
  }

  forward(re, im) {
    const n = this.size
    for (let i = 0; i < n; i += 1) {
      const j = this.rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j += 1) {
          const k = j * step
          const cr = this.cos[k]
          const ci = this.sin[k]
          const ar = re[i + j + half]
          const ai = im[i + j + half]
          const tr = ar * cr - ai * ci
          const ti = ar * ci + ai * cr
          re[i + j + half] = re[i + j] - tr
          im[i + j + half] = im[i + j] - ti
          re[i + j] += tr
          im[i + j] += ti
        }
      }
    }
  }

  inverse(re, im) {
    for (let i = 0; i < this.size; i += 1) im[i] = -im[i]
    this.forward(re, im)
    for (let i = 0; i < this.size; i += 1) im[i] = -im[i]
  }
}

/* ------------------------------------------------------------- filtering --- */

export class Biquad {
  constructor() {
    this.b0 = 1
    this.b1 = 0
    this.b2 = 0
    this.a1 = 0
    this.a2 = 0
    this.z1 = 0
    this.z2 = 0
  }

  setPeaking(freq, q, gainDb, sampleRate) {
    const w0 = (TWO_PI * clamp(freq, 20, sampleRate * 0.45)) / sampleRate
    const alpha = Math.sin(w0) / (2 * Math.max(0.1, q))
    const a = dbToGain(gainDb)
    const cosw = Math.cos(w0)
    const a0 = 1 + alpha / a
    this.b0 = (1 + alpha * a) / a0
    this.b1 = (-2 * cosw) / a0
    this.b2 = (1 - alpha * a) / a0
    this.a1 = (-2 * cosw) / a0
    this.a2 = (1 - alpha / a) / a0
  }

  process(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  reset() {
    this.z1 = 0
    this.z2 = 0
  }
}

export const DEFAULT_EQ_BANDS = [60, 170, 350, 1000, 3500, 10000]

export class EqBank {
  constructor(sampleRate) {
    this.sampleRate = sampleRate
    this.bands = DEFAULT_EQ_BANDS.map((freq) => ({
      freq,
      filterL: new Biquad(),
      filterR: new Biquad(),
      gain: 0,
    }))
    this.setGains(new Array(DEFAULT_EQ_BANDS.length).fill(0))
  }

  setGains(gains) {
    for (let i = 0; i < this.bands.length; i += 1) {
      const gain = clamp(Number(gains?.[i] ?? 0), -15, 15)
      if (gain === this.bands[i].gain) continue
      this.bands[i].gain = gain
      this.bands[i].filterL.setPeaking(this.bands[i].freq, 1.0, gain, this.sampleRate)
      this.bands[i].filterR.setPeaking(this.bands[i].freq, 1.0, gain, this.sampleRate)
    }
  }

  processSample(left, right) {
    let l = left
    let r = right
    for (const band of this.bands) {
      l = band.filterL.process(l)
      r = band.filterR.process(r)
    }
    return [l, r]
  }

  reset() {
    for (const band of this.bands) {
      band.filterL.reset()
      band.filterR.reset()
    }
  }
}

/* ------------------------------------------------------- phase vocoder ---- */

function principalArg(value) {
  let v = value
  while (v > Math.PI) v -= TWO_PI
  while (v < -Math.PI) v += TWO_PI
  return v
}

/**
 * Pull-based phase-vocoder time stretcher over fully decoded source buffers.
 *
 * Analysis hop = synthesisHop / stretch; each bin's phase is propagated from the
 * measured phase deviation, so the output keeps the source's frequencies (pitch)
 * while changing duration. Hann analysis + synthesis at 75% overlap sums to 1.5,
 * hence the 2/(3N) inverse scale.
 *
 * A phase vocoder smears transients more than WSOLA, but it is predictable and
 * pitch-exact. Preview quality is labelled in the UI; the Python engine remains
 * the rendered path.
 */
export class PhaseVocoder {
  constructor(channels, sampleRate, { frameSize = 1024, synthesisHop = 256 } = {}) {
    this.channels = channels
    this.sampleRate = sampleRate
    this.frameSize = frameSize
    this.hop = synthesisHop
    this.bins = frameSize / 2 + 1
    this.window = hann(frameSize)
    this.fft = new Fft(frameSize)
    this.prevPhaseL = new Float32Array(this.bins)
    this.sumPhaseL = new Float32Array(this.bins)
    this.prevPhaseR = new Float32Array(this.bins)
    this.sumPhaseR = new Float32Array(this.bins)
    this.re = new Float32Array(frameSize)
    this.im = new Float32Array(frameSize)
    this.olaL = new Float32Array(frameSize)
    this.olaR = new Float32Array(frameSize)
    this.queueL = new Float32Array(0)
    this.queueR = new Float32Array(0)
    this.pos = 0
    this.stretch = 1
    this.primed = false
    this.scale = 2 / (3 * frameSize)
  }

  get length() {
    return this.channels[0]?.length ?? 0
  }

  setPosition(frame) {
    this.pos = clamp(frame, 0, Math.max(0, this.length - 1))
    this.olaL.fill(0)
    this.olaR.fill(0)
    this.queueL = new Float32Array(0)
    this.queueR = new Float32Array(0)
    this.prevPhaseL.fill(0)
    this.sumPhaseL.fill(0)
    this.prevPhaseR.fill(0)
    this.sumPhaseR.fill(0)
    this.primed = false
  }

  setStretch(stretch) {
    this.stretch = clamp(stretch, 0.2, 5)
  }

  _sample(ch, index) {
    const data = this.channels[ch] || this.channels[0]
    if (!data) return 0
    if (index < 0) return 0
    const i = index | 0
    const frac = index - i
    if (i + 1 >= data.length) return data[data.length - 1] || 0
    return data[i] * (1 - frac) + data[i + 1] * frac
  }

  _synthChannel(ch, prevPhase, sumPhase, ola, analysisHop) {
    const n = this.frameSize
    const hs = this.hop
    const re = this.re
    const im = this.im
    const window = this.window
    for (let i = 0; i < n; i += 1) {
      re[i] = this._sample(ch, this.pos + i) * window[i]
      im[i] = 0
    }
    this.fft.forward(re, im)
    for (let k = 0; k < this.bins; k += 1) {
      const phase = Math.atan2(im[k], re[k])
      if (!this.primed) {
        prevPhase[k] = phase
        sumPhase[k] = phase
      } else {
        const expected = (TWO_PI * k * analysisHop) / n
        const deviation = principalArg(phase - prevPhase[k] - expected)
        sumPhase[k] += (TWO_PI * k * hs) / n + deviation
        prevPhase[k] = phase
      }
    }
    for (let k = 0; k < this.bins; k += 1) {
      const mag = Math.hypot(re[k], im[k])
      re[k] = mag * Math.cos(sumPhase[k])
      im[k] = mag * Math.sin(sumPhase[k])
      if (k > 0 && k < n / 2) {
        re[n - k] = re[k]
        im[n - k] = -im[k]
      }
    }
    this.fft.inverse(re, im)
    for (let i = 0; i < n; i += 1) ola[i] += re[i] * this.scale * window[i]
  }

  _frame() {
    const n = this.frameSize
    const hs = this.hop
    const analysisHop = hs / this.stretch
    this._synthChannel(0, this.prevPhaseL, this.sumPhaseL, this.olaL, analysisHop)
    this._synthChannel(1, this.prevPhaseR, this.sumPhaseR, this.olaR, analysisHop)
    this.primed = true

    const tailL = this.olaL.slice(0, hs)
    const tailR = this.olaR.slice(0, hs)
    this.olaL.copyWithin(0, hs)
    this.olaL.fill(0, n - hs)
    this.olaR.copyWithin(0, hs)
    this.olaR.fill(0, n - hs)
    this.queueL = tailL
    this.queueR = tailR
    this.pos += analysisHop
  }

  _pump(minSamples) {
    while (this.queueL.length < minSamples) {
      if (this.pos >= this.length) {
        const nextL = new Float32Array(this.queueL.length + this.hop)
        nextL.set(this.queueL)
        const nextR = new Float32Array(this.queueR.length + this.hop)
        nextR.set(this.queueR)
        this.queueL = nextL
        this.queueR = nextR
        return
      }
      const extraL = this.queueL
      const extraR = this.queueR
      this._frame()
      const mergedL = new Float32Array(extraL.length + this.queueL.length)
      mergedL.set(extraL)
      mergedL.set(this.queueL, extraL.length)
      const mergedR = new Float32Array(extraR.length + this.queueR.length)
      mergedR.set(extraR)
      mergedR.set(this.queueR, extraR.length)
      this.queueL = mergedL
      this.queueR = mergedR
    }
  }

  next() {
    if (this.queueL.length === 0) this._pump(1)
    if (this.queueL.length === 0) return [0, 0]
    const l = this.queueL[0]
    const r = this.queueR[0]
    this.queueL = this.queueL.subarray(1)
    this.queueR = this.queueR.subarray(1)
    return [l, r]
  }
}

/** Backwards-compatible alias for code that named the stretcher "Wsola". */
export const Wsola = PhaseVocoder

/* ------------------------------------------------------------- formant ---- */

/**
 * Cepstral spectral-envelope warp. `ratio > 1` moves formants up, `< 1` down.
 * Streaming: frames are analysed every `hop` samples with one frame of latency;
 * Hann analysis/synthesis at 75% overlap sums to 1.5, so output is scaled by 2/3.
 */
export class FormantWarp {
  constructor(sampleRate, frameSize = 1024, hop = 256, quefrency = 40) {
    this.sampleRate = sampleRate
    this.frameSize = frameSize
    this.hop = hop
    this.quefrency = quefrency
    this.fft = new Fft(frameSize)
    this.window = hann(frameSize)
    this.ratio = 1
    this.ringL = new Float32Array(frameSize)
    this.ringR = new Float32Array(frameSize)
    this.ringPos = 0
    this.filled = 0
    this.sinceFrame = 0
    this.olaL = new Float32Array(frameSize)
    this.olaR = new Float32Array(frameSize)
    this.outL = new Float32Array(0)
    this.outR = new Float32Array(0)
    this.re = new Float32Array(frameSize)
    this.im = new Float32Array(frameSize)
    this.cepRe = new Float32Array(frameSize)
    this.cepIm = new Float32Array(frameSize)
    this.frame = new Float32Array(frameSize)
    this.mag = new Float32Array(frameSize / 2 + 1)
    this.gains = new Float32Array(frameSize / 2 + 1)
    this._env = new Float32Array(frameSize / 2 + 1)
    this.scale = 2 / (3 * frameSize)
  }

  reset() {
    this.ringL.fill(0)
    this.ringR.fill(0)
    this.ringPos = 0
    this.filled = 0
    this.sinceFrame = 0
    this.olaL.fill(0)
    this.olaR.fill(0)
    this.outL = new Float32Array(0)
    this.outR = new Float32Array(0)
  }

  _envelope() {
    const n = this.frameSize
    for (let i = 0; i < n; i += 1) {
      // `mag` holds bins 0..n/2; mirror the upper half for a real cepstrum.
      const bin = i <= n / 2 ? i : n - i
      const value = Math.log((this.mag[bin] || 0) + 1e-9)
      this.cepRe[i] = clamp(Number.isFinite(value) ? value : -30, -30, 30)
      this.cepIm[i] = 0
    }
    this.fft.inverse(this.cepRe, this.cepIm)
    for (let i = this.quefrency; i < n - this.quefrency; i += 1) {
      this.cepRe[i] = 0
      this.cepIm[i] = 0
    }
    this.fft.forward(this.cepRe, this.cepIm)
    for (let i = 0; i < this._env.length; i += 1) {
      const value = Math.exp(clamp(this.cepRe[i] / n, -30, 30))
      this._env[i] = Number.isFinite(value) ? value : 0
    }
    return this._env
  }

  _processChannel(ring, ola) {
    const n = this.frameSize
    const re = this.re
    const im = this.im
    for (let i = 0; i < n; i += 1) {
      const idx = (this.ringPos + i) % n
      re[i] = ring[idx] * this.window[i]
      im[i] = 0
    }
    this.fft.forward(re, im)
    for (let i = 0; i < this.mag.length; i += 1) this.mag[i] = Math.hypot(re[i], im[i])
    this._envelope()
    let totalBefore = 0
    let totalAfter = 0
    for (let i = 0; i < this.mag.length; i += 1) {
      const mag = this.mag[i]
      const srcBin = i / this.ratio
      const i0 = Math.floor(srcBin)
      if (i0 >= this.mag.length - 1) {
        this.gains[i] = 0
        continue
      }
      const frac = srcBin - i0
      const target = this._env[i0] * (1 - frac) + this._env[i0 + 1] * frac
      const ratioGain = target / (this._env[i] + 1e-9)
      this.gains[i] = Number.isFinite(ratioGain) ? clamp(ratioGain, 0, 8) : 1
      totalBefore += mag * mag
      totalAfter += (mag * this.gains[i]) ** 2
    }
    // Preserve broadband energy so a formant move changes colour, not loudness.
    const normalize =
      totalAfter > 1e-9 ? clamp(Math.sqrt(totalBefore / totalAfter), 0.25, 4) : 1
    for (let i = 0; i < this.mag.length; i += 1) {
      const gain = this.gains[i] * normalize
      re[i] *= gain
      im[i] *= gain
      if (i > 0 && i < n / 2) {
        re[n - i] *= gain
        im[n - i] *= gain
      }
    }
    this.fft.inverse(re, im)
    for (let i = 0; i < n; i += 1) ola[i] += re[i] * this.scale * this.window[i]
  }

  _frame() {
    this._processChannel(this.ringL, this.olaL)
    this._processChannel(this.ringR, this.olaR)
    const hop = this.hop
    const outL = new Float32Array(hop)
    const outR = new Float32Array(hop)
    outL.set(this.olaL.subarray(0, hop))
    outR.set(this.olaR.subarray(0, hop))
    this.olaL.copyWithin(0, hop)
    this.olaL.fill(0, this.frameSize - hop)
    this.olaR.copyWithin(0, hop)
    this.olaR.fill(0, this.frameSize - hop)
    const mergedL = new Float32Array(this.outL.length + hop)
    mergedL.set(this.outL)
    mergedL.set(outL, this.outL.length)
    this.outL = mergedL
    const mergedR = new Float32Array(this.outR.length + hop)
    mergedR.set(this.outR)
    mergedR.set(outR, this.outR.length)
    this.outR = mergedR
  }

  process(l, r) {
    const n = this.frameSize
    this.ringL[this.ringPos] = l
    this.ringR[this.ringPos] = r
    this.ringPos = (this.ringPos + 1) % n
    this.filled = Math.min(n, this.filled + 1)
    if (this.filled >= n) {
      this.sinceFrame += 1
      if (this.sinceFrame >= this.hop) {
        this.sinceFrame = 0
        // `ringPos` is the oldest sample and advances with the write head, so the
        // frame is always the most recent n samples in playback order.
        this._frame()
      }
    }
    if (this.outL.length === 0) return [0, 0]
    const outL = this.outL[0]
    const outR = this.outR[0]
    this.outL = this.outL.subarray(1)
    this.outR = this.outR.subarray(1)
    return [outL, outR]
  }
}

/* ------------------------------------------------------------ the graph --- */

export const DEFAULT_PARAMS = {
  speed: 1,
  transpose: 0,
  pitchCents: 0,
  formant: 1,
  varispeed: false,
  eq: [0, 0, 0, 0, 0, 0],
  reducer: 0,
  gainDb: 0,
  bypass: false,
  metronome: false,
  metronomeBpm: 100,
}

export class PlayerDsp {
  constructor(channels, sampleRate, options = {}) {
    this.channels = channels
    this.sampleRate = sampleRate
    this.stretcher = new Wsola(channels, sampleRate, options)
    this.eq = new EqBank(sampleRate)
    this.formant = null
    this.params = { ...DEFAULT_PARAMS, eq: [...DEFAULT_PARAMS.eq] }
    this.srcFrame = 0
    this.resamplePos = 0
    this.pendingL = 0
    this.pendingR = 0
    this.lastL = 0
    this.lastR = 0
    this.hasPending = false
    this.loop = { enabled: false, start: 0, end: 0 }
    this.ended = false
    this.ramp = 1
    this.rampStep = 0
    this.waitPoints = []
    this.waitIndex = 0
    this.waiting = false
    this.countInSamples = 0
    this.countInTotal = 0
    this.countInBeatSamples = 0
    this.countInPhase = 0
    this.metroSamples = 0
    this.metroBeat = 0
    this.metroPhase = 0
  }

  setParams(next) {
    const params = { ...this.params, ...next }
    params.speed = clamp(Number(params.speed) || 1, 0.25, 4)
    params.transpose = clamp(Number(params.transpose) || 0, -36, 36)
    params.pitchCents = clamp(Number(params.pitchCents) || 0, -100, 100)
    params.formant = clamp(Number(params.formant) || 1, 0.2, 2)
    params.reducer = clamp(Number(params.reducer) || 0, 0, 1)
    params.gainDb = clamp(Number(params.gainDb) || 0, -24, 12)
    params.varispeed = Boolean(params.varispeed)
    params.bypass = Boolean(params.bypass)
    params.metronome = Boolean(params.metronome)
    params.metronomeBpm = clamp(Number(params.metronomeBpm) || 100, 30, 300)
    if (!Array.isArray(params.eq)) params.eq = [...DEFAULT_PARAMS.eq]
    params.eq = params.eq.slice(0, 6).map((g) => clamp(Number(g) || 0, -15, 15))
    while (params.eq.length < 6) params.eq.push(0)
    this.params = params
    this.eq.setGains(params.eq)
    this._updateStretch()
    const wantFormant = Math.abs(params.formant - 1) > 0.02 && !params.bypass
    if (wantFormant && !this.formant) this.formant = new FormantWarp(this.sampleRate)
    if (this.formant) this.formant.ratio = params.formant
    if (!wantFormant) this.formant = null
  }

  _pitchRatio() {
    const p = this.params
    if (p.bypass) return 1
    const transpose = semitonesToRatio(p.transpose, p.pitchCents)
    return p.varispeed ? transpose * p.speed : transpose
  }

  _updateStretch() {
    const p = this.params
    const pitch = this._pitchRatio()
    this.stretcher.setStretch(p.bypass ? 1 : pitch / p.speed)
  }

  get latencySeconds() {
    if (this.params.bypass) return 0
    const frame = this.stretcher.frameSize / this.sampleRate
    return frame + (this.formant ? this.formant.frameSize / this.sampleRate : 0)
  }

  get positionSeconds() {
    return this.srcFrame / this.sampleRate
  }

  seek(seconds) {
    this.srcFrame = clamp(seconds * this.sampleRate, 0, Math.max(0, this.stretcher.length - 1))
    this.stretcher.setPosition(this.srcFrame)
    this.resamplePos = 0
    this.hasPending = false
    this.eq.reset()
    if (this.formant) this.formant.reset()
    this.ended = false
    this.waitIndex = 0
    this.waiting = false
    this.metroSamples = 0
    this.metroBeat = 0
    this._startRamp()
  }

  setLoop(range) {
    this.loop = {
      enabled: Boolean(range?.enabled),
      start: Number(range?.start) || 0,
      end: Number(range?.end) || 0,
    }
  }

  setWaitPoints(points) {
    this.waitPoints = Array.isArray(points) ? points.slice().sort((a, b) => a - b) : []
    this.waitIndex = 0
    this.waiting = false
  }

  startCountIn(beats, bpm) {
    const beatSamples = (60 / Math.max(30, bpm || 100)) * this.sampleRate
    this.countInTotal = Math.max(0, Math.round(beats * beatSamples))
    this.countInSamples = this.countInTotal
    this.countInBeatSamples = beatSamples
    this.countInPhase = 0
  }

  cancelCountIn() {
    this.countInSamples = 0
  }

  _startRamp() {
    this.ramp = 0
    this.rampStep = 1 / (0.008 * this.sampleRate)
  }

  nextSample() {
    const p = this.params
    if (p.bypass) {
      const l = this.stretcher._sample(0, this.srcFrame)
      const r = this.stretcher._sample(1, this.srcFrame)
      this.srcFrame += 1
      if (this.srcFrame >= this.stretcher.length) this.ended = true
      return [l, r]
    }

    const pitch = this._pitchRatio()
    if (!this.hasPending) {
      const a = this.stretcher.next()
      const b = this.stretcher.next()
      this.pendingL = a[0]
      this.pendingR = a[1]
      this.lastL = b[0]
      this.lastR = b[1]
      this.hasPending = true
      this.resamplePos = 0
    }
    const frac = this.resamplePos
    let l = this.pendingL * (1 - frac) + this.lastL * frac
    let r = this.pendingR * (1 - frac) + this.lastR * frac
    this.resamplePos += pitch
    while (this.resamplePos >= 1) {
      this.pendingL = this.lastL
      this.pendingR = this.lastR
      const next = this.stretcher.next()
      this.lastL = next[0]
      this.lastR = next[1]
      this.resamplePos -= 1
    }
    this.srcFrame = Math.min(this.stretcher.pos, this.stretcher.length)
    if (this.srcFrame >= this.stretcher.length) this.ended = true

    if (this.formant) {
      const out = this.formant.process(l, r)
      l = out[0]
      r = out[1]
    }
    const filtered = this.eq.processSample(l, r)
    l = filtered[0]
    r = filtered[1]

    if (p.reducer > 0) {
      const center = (l + r) * 0.5
      l -= center * p.reducer
      r -= center * p.reducer
    }
    const gain = dbToGain(p.gainDb)
    l *= gain
    r *= gain
    if (this.ramp < 1) {
      this.ramp = Math.min(1, this.ramp + this.rampStep)
      l *= this.ramp
      r *= this.ramp
    }
    return [l, r]
  }

  render(frames) {
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    const sr = this.sampleRate
    const p = this.params
    for (let i = 0; i < frames; i += 1) {
      if (this.countInSamples > 0) {
        const progressed = this.countInTotal - this.countInSamples
        const beatPos = progressed % this.countInBeatSamples
        this.countInPhase += (TWO_PI * 1000) / sr
        let click = 0
        const clickLen = 0.02 * sr
        if (beatPos < clickLen) {
          click = Math.sin(this.countInPhase) * 0.35 * (1 - beatPos / clickLen)
        }
        left[i] = click
        right[i] = click
        this.countInSamples -= 1
        continue
      }
      const [l, r] = this.nextSample()
      let click = 0
      if (p.metronome) {
        const beatSamples = (60 / p.metronomeBpm) * sr
        this.metroSamples += 1
        if (this.metroSamples >= beatSamples) {
          this.metroSamples -= beatSamples
          this.metroBeat = (this.metroBeat + 1) % 4
        }
        const clickLen = 0.025 * sr
        if (this.metroSamples < clickLen) {
          this.metroPhase += (TWO_PI * (this.metroBeat === 0 ? 1600 : 1000)) / sr
          const accent = this.metroBeat === 0 ? 0.3 : 0.18
          click = Math.sin(this.metroPhase) * accent * (1 - this.metroSamples / clickLen)
        }
      }
      left[i] = l + click
      right[i] = r + click
      if (this.loop.enabled && this.loop.end > this.loop.start) {
        if (this.positionSeconds >= this.loop.end) this.seek(this.loop.start)
      }
      if (this.waitPoints.length && !this.waiting) {
        const point = this.waitPoints[this.waitIndex]
        if (point != null && this.positionSeconds >= point) {
          this.waiting = true
          this.waitIndex += 1
        }
      }
      if (this.ended) {
        for (let j = i + 1; j < frames; j += 1) {
          left[j] = 0
          right[j] = 0
        }
        break
      }
    }
    return { left, right, position: this.positionSeconds, endOfSource: this.ended }
  }
}

/* --------------------------------------------------------- worklet glue --- */

const ProcessorBase = typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {}

class NeiroPlayerProcessor extends ProcessorBase {
  constructor(options) {
    super()
    this.dsp = null
    this.playing = false
    this.port.onmessage = (event) => this._onMessage(event.data)
    this.blockCount = 0
    // Atomic initialization for offline rendering (and callers that want to
    // avoid a message race before the first process() call).
    const initial = (options && options.processorOptions) || {}
    if (initial.channels) {
      this._load(initial)
      if (initial.params) this.dsp.setParams(initial.params)
      if (initial.play) {
        if (initial.from != null) this.dsp.seek(initial.from)
        this.dsp.waiting = false
        this.playing = true
      }
    }
  }

  _load(message) {
    const rate = message.sampleRate || (typeof sampleRate !== 'undefined' ? sampleRate : 48000)
    const channels = message.channels.map((c) =>
      c instanceof Float32Array ? c : new Float32Array(c),
    )
    this.dsp = new PlayerDsp(channels, rate)
    this.port.postMessage({
      type: 'loaded',
      duration: (channels[0]?.length || 0) / rate,
      latencySeconds: this.dsp.latencySeconds,
    })
  }

  _onMessage(message) {
    const { type } = message || {}
    if (type === 'load') {
      this._load(message)
      return
    }
    if (!this.dsp) return
    if (type === 'params') {
      this.dsp.setParams(message.params || {})
      this.port.postMessage({ type: 'latency', seconds: this.dsp.latencySeconds })
    } else if (type === 'play') {
      if (message.from != null) this.dsp.seek(message.from)
      if (message.countInBeats) this.dsp.startCountIn(message.countInBeats, message.bpm || 100)
      this.dsp.waiting = false
      this.playing = true
    } else if (type === 'pause') {
      this.playing = false
    } else if (type === 'seek') {
      this.dsp.seek(message.to || 0)
    } else if (type === 'loop') {
      this.dsp.setLoop(message.range)
    } else if (type === 'waitPoints') {
      this.dsp.setWaitPoints(message.points || [])
    } else if (type === 'resume') {
      this.dsp.waiting = false
      this.playing = true
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output || !this.dsp) return true
    const frames = output[0].length
    if (!this.playing) {
      for (const channel of output) channel.fill(0)
      return true
    }
    if (this.dsp.waiting) {
      for (const channel of output) channel.fill(0)
      this.port.postMessage({ type: 'wait', position: this.dsp.positionSeconds })
      this.playing = false
      return true
    }
    const rendered = this.dsp.render(frames)
    output[0].set(rendered.left)
    if (output[1]) output[1].set(rendered.right)
    for (let i = 2; i < output.length; i += 1) output[i].fill(0)
    this.blockCount += 1
    if (this.blockCount % 8 === 0) {
      this.port.postMessage({
        type: 'status',
        position: rendered.position,
        playing: !rendered.endOfSource,
        latencySeconds: this.dsp.latencySeconds,
      })
    }
    if (rendered.endOfSource) {
      this.playing = false
      this.port.postMessage({ type: 'ended', position: rendered.position })
    }
    return true
  }
}

export { NeiroPlayerProcessor }

if (typeof registerProcessor === 'function') {
  registerProcessor('neiro-player', NeiroPlayerProcessor)
}
