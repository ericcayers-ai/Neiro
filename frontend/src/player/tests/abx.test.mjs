import assert from 'node:assert/strict'
import test from 'node:test'

import { createTrials, scoreTrial, summarize } from '../abx.ts'

function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

test('ABX trials are balanced and deterministic with an injected RNG', () => {
  const a = createTrials(10, seeded(42))
  const b = createTrials(10, seeded(42))
  assert.deepEqual(a, b)
  assert.equal(a.length, 10)
  assert.equal(a.filter((trial) => trial.xIsA).length, 5)
  assert.deepEqual(
    a.map((trial) => trial.index),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
})

test('ABX scoring counts correct, wrong and unsure separately', () => {
  assert.equal(scoreTrial({ index: 0, xIsA: true }, 'A').correct, true)
  assert.equal(scoreTrial({ index: 0, xIsA: true }, 'B').correct, false)
  assert.equal(scoreTrial({ index: 0, xIsA: false }, 'B').correct, true)
  assert.equal(scoreTrial({ index: 0, xIsA: false }, 'unsure').correct, null)

  const summary = summarize([
    { index: 0, choice: 'A', correct: true },
    { index: 1, choice: 'B', correct: false },
    { index: 2, choice: 'unsure', correct: null },
  ])
  assert.deepEqual(summary, { trials: 3, correct: 1, unsure: 1, accuracy: 0.5 })
  assert.equal(summarize([]).accuracy, null)
})

test('ABX rejects impossible trial counts', () => {
  assert.throws(() => createTrials(0), /1\.\.50/)
  assert.throws(() => createTrials(51), /1\.\.50/)
  assert.throws(() => createTrials(2.5), /1\.\.50/)
})
