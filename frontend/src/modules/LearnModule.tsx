import { useEffect, useRef, useState } from 'react'
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
  const [noteIndex, setNoteIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const noteIndexRef = useRef(0)
  const pitchesRef = useRef<number[]>([])

  const targetPitches = transcribeResult
    ? Object.values(transcribeResult.tracks || {})
        .flat()
        .sort((a, b) => a.onset - b.onset)
        .map((e) => e.pitch)
    : []

  noteIndexRef.current = noteIndex
  pitchesRef.current = targetPitches

  const advance = (source: string) => {
    setNoteIndex((i) => {
      const total = pitchesRef.current.length
      const next = Math.min(i + 1, Math.max(0, total))
      setFeedback(`${source}: advanced to note ${next}/${total || '—'}`)
      return next
    })
  }

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (waitMode !== 'key') return
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        advance('Keyboard')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [waitMode])

  useEffect(() => {
    if (waitMode !== 'webmidi') return
    let cancelled = false
    let access: MIDIAccess | null = null

    const onMessage = (ev: MIDIMessageEvent) => {
      const data = ev.data
      if (!data || data.length < 3) return
      const status = data[0]
      const note = data[1]
      const velocity = data[2]
      const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0
      if (!isNoteOn) return
      const expected = pitchesRef.current[noteIndexRef.current]
      if (expected == null) {
        setFeedback(`Heard MIDI note ${note} (no remaining target notes)`)
        return
      }
      if (note === expected) {
        advance('WebMIDI correct')
      } else {
        setFeedback(`Heard ${note}, expected ${expected} — try again`)
      }
    }

    const attach = async () => {
      if (!navigator.requestMIDIAccess) {
        setFeedback('WebMIDI is not available in this browser — use keyboard step mode.')
        return
      }
      try {
        access = await navigator.requestMIDIAccess({ sysex: false })
        if (cancelled) return
        setFeedback('WebMIDI connected — play the expected pitch to advance.')
        for (const input of access.inputs.values()) {
          input.addEventListener('midimessage', onMessage as EventListener)
        }
      } catch {
        setFeedback('WebMIDI permission denied — use keyboard step mode.')
      }
    }
    void attach()
    return () => {
      cancelled = true
      if (access) {
        for (const input of access.inputs.values()) {
          input.removeEventListener('midimessage', onMessage as EventListener)
        }
      }
    }
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
          Playback waits at each note group until Space/Enter or the matching MIDI pitch.
          {targetPitches.length > 0
            ? ` Target ${Math.min(noteIndex + 1, targetPitches.length)}/${targetPitches.length}: MIDI ${targetPitches[Math.min(noteIndex, targetPitches.length - 1)]}.`
            : ''}
        </span>
      </div>

      <audio
        ref={audioRef}
        controls
        loop={looping}
        src={file.audioUrl}
        style={{ width: '100%', marginTop: 12 }}
      />
      {feedback && (
        <p className="muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  )
}
