/* Companion capture shifter: bypass exactness, pitch direction, finite output. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GrainShifter, pitchRatioForSemitones, clamp } from '../src/audio/capture-worklet.js'

const SR = 44100
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sine(freq, seconds, amp = 0.3) {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return out
}

function zeroCrossingFreq(samples) {
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
  return ((crossings - 1) * SR) / (last - first)
}

test('pitch ratio math', () => {
  assert.ok(Math.abs(pitchRatioForSemitones(12) - 2) < 1e-9)
  assert.ok(Math.abs(pitchRatioForSemitones(0, 100) - 1.059463) < 0.001)
  assert.equal(clamp(9, 0, 1), 1)
})

test('bypass returns the pushed samples', () => {
  const input = sine(440, 0.2)
  const shifter = new GrainShifter(SR)
  shifter.bypass = true
  for (let i = 0; i < input.length; i += 1) {
    shifter.push(input[i])
    assert.equal(shifter.next(), input[i])
  }
})

test('+12 semitones roughly doubles the perceived frequency', () => {
  const input = sine(220, 0.6)
  const shifter = new GrainShifter(SR)
  shifter.setPitch(2)
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    shifter.push(input[i])
    out[i] = shifter.next()
  }
  const freq = zeroCrossingFreq(out.subarray(Math.floor(SR * 0.2), Math.floor(SR * 0.5)))
  assert.ok(freq > 380 && freq < 500, `freq ${freq}`)
})

test('output stays finite at extreme ratios', () => {
  const shifter = new GrainShifter(SR)
  shifter.setPitch(4)
  for (let i = 0; i < 20000; i += 1) {
    shifter.push(Math.sin(i / 10) * 0.5)
    assert.ok(Number.isFinite(shifter.next()))
  }
})

test('manifest is MV3 and the worklet is local', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  assert.ok(manifest.optional_permissions.includes('tabCapture'))
  assert.ok(!(manifest.permissions || []).includes('tabCapture'))
  const worklet = readFileSync(join(root, 'src/audio/capture-worklet.js'), 'utf8')
  assert.ok(worklet.includes("registerProcessor('neiro-capture'"))
  assert.ok(!/rb\.wasm/i.test(worklet))
})

test('grain shifter produces finite output when shifting', () => {
  const shifter = new GrainShifter(48000)
  shifter.setPitch(2)
  const out = []
  for (let i = 0; i < 4096; i += 1) {
    shifter.push(Math.sin((2 * Math.PI * 220 * i) / 48000))
    out.push(shifter.next())
  }
  assert.ok(out.every(Number.isFinite), 'no NaN/Inf from fractional taps')
  assert.ok(out.slice(2048).some((value) => Math.abs(value) > 0.01), 'audible output')
})
