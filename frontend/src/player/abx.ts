/** Blind ABX trial logic — pure so it can be tested without audio. */

export type AbxChoice = 'A' | 'B' | 'unsure'

export interface AbxTrial {
  index: number
  /** True when the hidden X excerpt is the A (original) source. */
  xIsA: boolean
}

export interface AbxResult {
  index: number
  choice: AbxChoice
  /** null for "can't tell". */
  correct: boolean | null
}

export interface AbxSummary {
  trials: number
  correct: number
  unsure: number
  /** Accuracy over decided trials; null when every trial was "can't tell". */
  accuracy: number | null
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

/**
 * Build a balanced trial list (half X=A, half X=B) in random order.
 * `rng` is injectable so tests are deterministic.
 */
export function createTrials(count: number, rng: () => number = Math.random): AbxTrial[] {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error('ABX trial count must be an integer in 1..50')
  }
  const flags = shuffle(
    Array.from({ length: count }, (_, index) => index % 2 === 0),
    rng,
  )
  return flags.map((xIsA, index) => ({ index, xIsA }))
}

/** Score one answer. "unsure" is counted separately, not as wrong. */
export function scoreTrial(trial: AbxTrial, choice: AbxChoice): AbxResult {
  if (choice === 'unsure') return { index: trial.index, choice, correct: null }
  return {
    index: trial.index,
    choice,
    correct: (choice === 'A') === trial.xIsA,
  }
}

export function summarize(results: AbxResult[]): AbxSummary {
  const decided = results.filter((result) => result.correct !== null)
  const correct = decided.filter((result) => result.correct).length
  return {
    trials: results.length,
    correct,
    unsure: results.length - decided.length,
    accuracy: decided.length ? correct / decided.length : null,
  }
}
