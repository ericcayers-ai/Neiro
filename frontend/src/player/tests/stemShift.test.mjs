import assert from 'node:assert/strict'
import test from 'node:test'

import { GrainShifter } from '../worklet/stem-shift-worklet.js'

function rms(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
}

test('stem shifter passes audio through when bypassed', () => {
  const shifter = new GrainShifter(48000)
  shifter.bypass = true
  for (let i = 0; i < 2048; i += 1) {
    shifter.push(Math.sin((2 * Math.PI * 440 * i) / 48000))
  }
  const out = []
  for (let i = 0; i < 512; i += 1) out.push(shifter.next())
  assert.ok(out.every(Number.isFinite))
  assert.ok(rms(out) > 0.1)
})

test('stem shifter produces finite output and clamps the ratio', () => {
  const shifter = new GrainShifter(48000)
  shifter.setPitch(2)
  assert.equal(shifter.ratio, 2)
  shifter.setPitch(100)
  assert.equal(shifter.ratio, 4)
  shifter.setPitch(0.01)
  assert.equal(shifter.ratio, 0.25)

  const out = []
  for (let i = 0; i < 4096; i += 1) {
    shifter.push(Math.sin((2 * Math.PI * 220 * i) / 48000))
    out.push(shifter.next())
  }
  assert.ok(out.every(Number.isFinite), 'no NaN/Inf')
  assert.ok(rms(out.slice(2048)) > 0.05, 'audible output')
})
