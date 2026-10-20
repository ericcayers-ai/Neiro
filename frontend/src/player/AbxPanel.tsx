import { useEffect, useRef, useState } from 'react'

import { createTrials, scoreTrial, summarize, type AbxChoice, type AbxResult } from './abx'

interface Props {
  originalUrl: string
  renderedUrl: string
  /** Used to keep excerpts inside the shorter of the two files. */
  duration: number
  onClose: () => void
}

const TRIALS = 10
const EXCERPT_SECONDS = 4

/**
 * Blind ABX listening test: A is always the original, B the rendered engine
 * output, and X is a hidden copy of one of them. The listener answers which one
 * X matched. This evaluates whether the render is distinguishable; it does not
 * claim a quality preference.
 */
export function AbxPanel({ originalUrl, renderedUrl, duration, onClose }: Props) {
  const [trials] = useState(() => createTrials(TRIALS))
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<AbxResult[]>([])
  const [revealed, setRevealed] = useState<AbxResult | null>(null)
  const [playing, setPlaying] = useState<'A' | 'B' | 'X' | null>(null)
  const [error, setError] = useState('')
  const audioA = useRef<HTMLAudioElement | null>(null)
  const audioB = useRef<HTMLAudioElement | null>(null)
  const timer = useRef<number | null>(null)

  const maxStart = Math.max(0, (duration || EXCERPT_SECONDS) - EXCERPT_SECONDS - 0.25)
  // One fixed offset per trial so A/B/X are compared at the same position.
  const [offsets] = useState(() =>
    Array.from({ length: TRIALS }, (_, i) => {
      // Deterministic spread with a little jitter; avoids Math.random in render.
      const slot = (i + 0.5) / TRIALS
      return Math.max(0, Math.min(maxStart, slot * maxStart))
    }),
  )

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    audioA.current?.pause()
    audioB.current?.pause()
    setPlaying(null)
  }

  useEffect(() => stop, [])

  const play = (kind: 'A' | 'B' | 'X') => {
    stop()
    setError('')
    const trial = trials[index]
    const useOriginal = kind === 'A' || (kind === 'X' && trial.xIsA)
    const audio = useOriginal ? audioA.current : audioB.current
    if (!audio) return
    audio.currentTime = offsets[index] ?? 0
    void audio
      .play()
      .then(() => {
        setPlaying(kind)
        timer.current = window.setTimeout(() => stop(), EXCERPT_SECONDS * 1000)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setPlaying(null)
      })
  }

  const vote = (choice: AbxChoice) => {
    stop()
    const result = scoreTrial(trials[index], choice)
    setResults((current) => [...current, result])
    setRevealed(result)
  }

  const next = () => {
    setRevealed(null)
    setIndex((value) => value + 1)
  }

  const done = index >= trials.length
  const summary = summarize(results)

  return (
    <div
      className="player-abx-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          stop()
          onClose()
        }
      }}
    >
      <div className="player-abx" role="dialog" aria-modal="true" aria-label="Blind ABX listening test">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Blind ABX</h3>
          <button type="button" onClick={() => { stop(); onClose() }}>
            Close
          </button>
        </div>

        <audio ref={audioA} src={originalUrl} preload="auto" hidden />
        <audio ref={audioB} src={renderedUrl} preload="auto" hidden />

        {done ? (
          <>
            <p className="intent">
              Finished {summary.trials} trials · correct {summary.correct} · can’t tell{' '}
              {summary.unsure}
              {summary.accuracy != null ? ` · accuracy ${Math.round(summary.accuracy * 100)}%` : ''}
            </p>
            <p className="intent">
              Chance is 50%. Accuracy near 50% suggests the render is hard to distinguish
              in this excerpt; this is a discrimination test, not a preference score.
            </p>
            <div className="row">
              <button type="button" onClick={() => { setResults([]); setIndex(0); setRevealed(null) }}>
                Run again
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="intent">
              Trial {index + 1} of {trials.length}. A is the original, B is the rendered engine
              output. X is a hidden copy of one of them — play all three, then say which one X is.
            </p>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className={playing === 'A' ? 'active' : ''} onClick={() => play('A')}>
                Play A (original)
              </button>
              <button type="button" className={playing === 'B' ? 'active' : ''} onClick={() => play('B')}>
                Play B (rendered)
              </button>
              <button type="button" className={playing === 'X' ? 'active' : ''} onClick={() => play('X')}>
                Play X (hidden)
              </button>
            </div>
            {error && <p className="intent" role="status">{error}</p>}

            {revealed ? (
              <div className="player-abx-reveal" role="status" aria-live="polite">
                <strong>
                  {revealed.correct === null
                    ? 'No answer recorded.'
                    : revealed.correct
                      ? 'Correct — you identified X.'
                      : 'Not correct this time.'}
                </strong>{' '}
                X was {trials[index].xIsA ? 'A (original)' : 'B (rendered)'}.
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={next}>
                    {index + 1 >= trials.length ? 'See summary' : 'Next trial'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => vote('A')}>X is A</button>
                <button type="button" onClick={() => vote('B')}>X is B</button>
                <button type="button" onClick={() => vote('unsure')}>Can’t tell</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
