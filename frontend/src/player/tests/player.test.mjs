/**
 * Node unit tests for the Neiro player DSP kernels.
 *
 * These run without a browser: the worklet module exports its kernels, so the
 * stretcher, resampler, EQ, reducer and formant warp are all testable here. The
 * browser-only surface (AudioContext wiring, tab capture) needs the addon e2e run.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Fft,
  PlayerDsp,
  FormantWarp,
  EqBank,
  dbToGain,
  semitonesToRatio,
  clamp,
} from '../worklet/player-worklet.js'

const SR = 44100

function sine(freq, seconds, amp = 0.3, sr = SR) {
  const n = Math.round(seconds * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

function stereo(left) {
  return [left, Float32Array.from(left)]
}

function render(dsp, seconds, block = 1024) {
  const total = Math.round(seconds * SR)
  const out = new Float32Array(total)
  let pos = 0
  while (pos < total) {
    const frames = Math.min(block, total - pos)
    const chunk = dsp.render(frames)
    out.set(chunk.left.subarray(0, frames), pos)
    pos += frames
    if (chunk.endOfSource) break
  }
  return out
}

function rms(samples, from = 0, to = samples.length) {
  let sum = 0
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

function zeroCrossingFreq(samples, sr = SR) {
  let crossings = 0
  let first = -1
  let last = -1
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      if (first < 0) first = i
      last = i
      crossings += 1
    }
  }
  if (crossings < 2) return 0
  return ((crossings - 1) * sr) / (last - first)
}

function spectralPeak(samples, sr = SR) {
  const n = 2048
  const fft = new Fft(n)
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  const start = Math.max(0, Math.floor(samples.length / 2) - n / 2)
  for (let i = 0; i < n; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    re[i] = (samples[start + i] || 0) * w
  }
  fft.forward(re, im)
  let best = 0
  let bestMag = -1
  for (let i = 1; i < n / 2; i += 1) {
    const mag = Math.hypot(re[i], im[i])
    if (mag > bestMag) {
      bestMag = mag
      best = i
    }
  }
  return (best * sr) / n
}

test('clamp and unit conversions', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-5, 0, 3), 0)
  assert.ok(Math.abs(semitonesToRatio(12) - 2) < 1e-9)
  assert.ok(Math.abs(dbToGain(6) - 1.995) < 0.01)
})

test('fft round-trips a signal', () => {
  const n = 512
  const fft = new Fft(n)
  const src = new Float32Array(n)
  for (let i = 0; i < n; i += 1) src[i] = Math.sin(i / 7) + 0.3 * Math.cos(i / 3)
  const re = Float32Array.from(src)
  const im = new Float32Array(n)
  fft.forward(re, im)
  fft.inverse(re, im)
  for (let i = 0; i < n; i += 1) {
    assert.ok(Math.abs(re[i] / n - src[i]) < 1e-4, `sample ${i}`)
  }
})

test('bypass is sample-exact (null test)', () => {
  const left = sine(440, 0.5)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ bypass: true })
  dsp.seek(0)
  const out = render(dsp, 0.25)
  for (let i = 0; i < out.length; i += 1) assert.equal(out[i], left[i])
})

test('speed 0.5 doubles duration without changing pitch', () => {
  const left = sine(440, 1.0)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ speed: 0.5 })
  dsp.seek(0)
  const out = render(dsp, 2.6)
  let last = 0
  for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i]) > 1e-4) last = i
  const duration = last / SR
  assert.ok(duration > 1.8 && duration < 2.2, `duration ${duration}`)
  const freq = zeroCrossingFreq(out.subarray(Math.floor(SR * 0.6), Math.floor(SR * 1.4)))
  assert.ok(Math.abs(freq - 440) < 12, `pitch ${freq}`)
  assert.ok(rms(out, 0, out.length) > 0.05)
})

test('transpose +12 doubles the pitch and keeps duration', () => {
  const left = sine(220, 1.0)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ transpose: 12 })
  dsp.seek(0)
  const out = render(dsp, 2.0)
  let last = 0
  for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i]) > 1e-4) last = i
  const duration = last / SR
  assert.ok(duration > 0.85 && duration < 1.15, `duration ${duration}`)
  const freq = zeroCrossingFreq(out.subarray(Math.floor(SR * 0.35), Math.floor(SR * 0.75)))
  assert.ok(Math.abs(freq - 440) < 18, `pitch ${freq}`)
})

test('varispeed links pitch and speed', () => {
  const left = sine(220, 1.0)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ speed: 2, varispeed: true })
  dsp.seek(0)
  const out = render(dsp, 1.2)
  let last = 0
  for (let i = 0; i < out.length; i += 1) if (Math.abs(out[i]) > 1e-4) last = i
  const duration = last / SR
  assert.ok(duration > 0.4 && duration < 0.6, `duration ${duration}`)
  const freq = zeroCrossingFreq(out.subarray(Math.floor(SR * 0.1), Math.floor(SR * 0.3)))
  assert.ok(Math.abs(freq - 440) < 25, `pitch ${freq}`)
})

test('EQ boost raises the matching band', () => {
  const left = sine(1000, 0.8, 0.2)
  function run(gain) {
    const dsp = new PlayerDsp(stereo(left), SR)
    dsp.setParams({ eq: [0, 0, 0, gain, 0, 0] })
    dsp.seek(0)
    const out = render(dsp, 0.6)
    return rms(out, Math.floor(SR * 0.25), Math.floor(SR * 0.55))
  }
  const flat = run(0)
  const boosted = run(9)
  assert.ok(boosted > flat * 1.8, `flat=${flat} boosted=${boosted}`)
})

test('vocal reducer cancels a centred signal', () => {
  const left = sine(440, 0.8, 0.3)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ reducer: 1 })
  dsp.seek(0)
  const out = render(dsp, 0.7)
  const tail = rms(out, Math.floor(SR * 0.3), Math.floor(SR * 0.65))
  assert.ok(tail < 0.01, `residual ${tail}`)
})

test('formant warp moves a spectral peak', () => {
  function resonantSource(seconds) {
    // Harmonic stack with amplitudes following a 1 kHz formant: a fair test of
    // envelope warping (a pure sine has no smooth envelope to move).
    const n = Math.round(seconds * SR)
    const out = new Float32Array(n)
    for (let harmonic = 1; harmonic <= 45; harmonic += 1) {
      const freq = harmonic * 100
      const amp = 0.05 * Math.exp(-(((freq - 1000) / 450) ** 2))
      for (let i = 0; i < n; i += 1) out[i] += amp * Math.sin((2 * Math.PI * freq * i) / SR)
    }
    return out
  }

  function peakFor(ratio) {
    const src = resonantSource(0.9)
    const fw = new FormantWarp(SR, 1024, 256, 40)
    fw.ratio = ratio
    fw.reset()
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 1) out[i] = fw.process(src[i], src[i])[0]
    return spectralPeak(out)
  }
  const up = peakFor(1.5)
  const down = peakFor(0.67)
  // The 1 kHz peak should move roughly with the ratio (FFT resolution ~21 Hz).
  assert.ok(up > 1250 && up < 1750, `up peak ${up}`)
  assert.ok(down > 500 && down < 850, `down peak ${down}`)
})

test('no NaN/Inf across extreme parameters', () => {
  const left = sine(300, 1.0)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({
    speed: 4,
    transpose: 36,
    formant: 2,
    eq: [15, -15, 15, -15, 15, -15],
    reducer: 1,
    gainDb: 12,
  })
  dsp.seek(0)
  const out = render(dsp, 0.5)
  for (const sample of out) assert.ok(Number.isFinite(sample))
})

test('processing is faster than real time on this machine', () => {
  const left = sine(220, 5.0)
  const dsp = new PlayerDsp(stereo(left), SR)
  dsp.setParams({ speed: 0.8, transpose: 2 })
  dsp.seek(0)
  const started = performance.now()
  const out = render(dsp, 5.0)
  const elapsed = (performance.now() - started) / 1000
  assert.ok(out.length === 5 * SR)
  // Real-time factor: seconds of audio rendered per wall-clock second.
  const rtf = 5.0 / elapsed
  assert.ok(rtf > 1.5, `RTF ${rtf.toFixed(2)} is slower than real time`)
  console.log(`player-bench rtf=${rtf.toFixed(2)} elapsed_ms=${(elapsed * 1000).toFixed(0)}`)
})

test('eq bank is transparent at zero gain', () => {
  const eq = new EqBank(SR)
  eq.setGains([0, 0, 0, 0, 0, 0])
  for (let i = 0; i < 100; i += 1) {
    const [l, r] = eq.processSample(0.5, -0.5)
    assert.ok(Math.abs(l - 0.5) < 1e-6)
    assert.ok(Math.abs(r + 0.5) < 1e-6)
  }
})
