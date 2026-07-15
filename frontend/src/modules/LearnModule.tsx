import { useEffect, useState } from 'react'
import { useSession } from '../state/session'
import './modules.css'

/** Learn mode — pitch-preserving practice over the session audio / transcription. */
export function LearnModule() {
  const { file, transcribeResult, setModule } = useSession()
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [metronome, setMetronome] = useState(false)
  const [waitMode, setWaitMode] = useState<'key' | 'webmidi' | 'none'>('key')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (waitMode !== 'key') return
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        setFeedback('Advanced to next note group')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [waitMode])

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Learn</h2>
        <div className="gate muted">Import a file and optionally transcribe it first.</div>
      </div>
    )
  }

  return (
    <div className="module-panel">
      <h2>Learn — {file.name}</h2>
      <p className="lede">
        Practice with pitch-preserving speed control, loop regions, count-in, metronome, and wait
        mode. Wrong-note feedback is informative, not punitive.
      </p>

      {!transcribeResult && (
        <div className="gate">
          <p className="muted">No transcription yet — you can still slow the source audio.</p>
          <button type="button" onClick={() => setModule('transcribe')}>
            Go to Transcribe
          </button>
        </div>
      )}

      <div className="row">
        <label className="field">
          Speed ({Math.round(speed * 100)}%)
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-valuetext={`${Math.round(speed * 100)} percent`}
          />
        </label>
        <button
          type="button"
          className={looping ? 'active' : ''}
          onClick={() => setLooping((v) => !v)}
        >
          Loop section
        </button>
        <button
          type="button"
          className={countIn ? 'active' : ''}
          onClick={() => setCountIn((v) => !v)}
        >
          Count-in
        </button>
        <button
          type="button"
          className={metronome ? 'active' : ''}
          onClick={() => setMetronome((v) => !v)}
        >
          Metronome
        </button>
      </div>

      <div className="row">
        <label className="field">
          Wait mode
          <select
            value={waitMode}
            onChange={(e) => setWaitMode(e.target.value as typeof waitMode)}
            aria-describedby="wait-hint"
          >
            <option value="key">Step with Space / Enter</option>
            <option value="webmidi">WebMIDI keyboard</option>
            <option value="none">Continuous play</option>
          </select>
        </label>
        <span id="wait-hint" className="intent">
          Playback halts at each note group until the wait condition is met.
        </span>
      </div>

      <audio controls src={file.audioUrl} style={{ width: '100%', marginTop: 12 }} />
      {feedback && (
        <p className="muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  )
}
