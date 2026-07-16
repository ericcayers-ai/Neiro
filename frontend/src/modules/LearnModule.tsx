import { useEffect, useRef, useState } from 'react'
import { useSession } from '../state/session'
import { useDawBridge } from '../hooks/useDawBridge'
import './modules.css'

/** Learn mode — pitch-preserving practice over the session audio / transcription. */
export function LearnModule() {
  const { file, transcribeResult, setModule } = useSession()
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [metronome, setMetronome] = useState(false)
  const [waitMode, setWaitMode] = useState<'key' | 'webmidi' | 'daw' | 'none'>('key')
  const [feedback, setFeedback] = useState('')
  const [noteIndex, setNoteIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const noteIndexRef = useRef(0)
  const pitchesRef = useRef<number[]>([])
  const waitModeRef = useRef(waitMode)
  waitModeRef.current = waitMode

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

  const { status: dawStatus, dawConnected } = useDawBridge({
    onMidiNoteOn: (pitch, _velocity, instanceId) => {
      if (waitModeRef.current !== 'daw' && waitModeRef.current !== 'webmidi') return
      const expected = pitchesRef.current[noteIndexRef.current]
      if (expected == null) {
        setFeedback(`DAW MIDI ${pitch} from ${instanceId} (no remaining target notes)`)
        return
      }
      if (pitch === expected) {
        advance(`DAW injector (${instanceId})`)
      } else {
        setFeedback(`DAW heard ${pitch}, expected ${expected} — try again`)
      }
    },
  })

  useEffect(() => {
    if (dawConnected && waitMode === 'key') setWaitMode('daw')
  }, [dawConnected, waitMode])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.playbackRate = speed
  }, [speed])

  // Metronome clicks via Web Audio (independent of pitch-preserving stretch).
  useEffect(() => {
    if (!metronome) return
    const bpm = transcribeResult?.tempo_bpm || file?.report?.estimated_bpm || 100
    const intervalMs = Math.max(200, (60_000 / Number(bpm)) * (countIn ? 1 : 1))
    let ctx: AudioContext | null = null
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    const id = window.setInterval(() => {
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.05
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.04)
    }, intervalMs)
    return () => {
      window.clearInterval(id)
      void ctx?.close()
    }
  }, [metronome, countIn, transcribeResult?.tempo_bpm, file?.report?.estimated_bpm])

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

  if (!file && !dawConnected) {
    return (
      <div className="module-panel">
        <h2>Learn</h2>
        <div className="gate muted">
          Import a file and optionally transcribe it first — or open the Neiro VST injector from
          your DAW to practice against a track.
        </div>
      </div>
    )
  }

  return (
    <div className="module-panel">
      <h2>Learn{file ? ` — ${file.name}` : ' — DAW injector'}</h2>
      <p className="lede">
        Practice with loop regions, count-in, metronome clicks, and wait mode. Speed currently uses
        browser playbackRate (not engine pitch-preserving stretch). Wrong-note feedback is
        informative, not punitive. DAW injectors share this single window for every mode — capture
        a take, then Separate / Restore / Transcribe here.
      </p>

      {dawConnected && dawStatus && (
        <div className="gate" role="status" aria-live="polite">
          <strong>DAW bridge active</strong> — {dawStatus.instance_count} injector
          {dawStatus.instance_count === 1 ? '' : 's'}; focused{' '}
          {dawStatus.focus_instance || 'none'}.
          <ul className="intent" style={{ marginTop: 8 }}>
            {dawStatus.instances.map((inst) => (
              <li key={inst.instance_id}>
                {inst.track_name} ({inst.host}) — {inst.instance_id}
                {inst.instance_id === dawStatus.focus_instance ? ' · focused' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

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
            <option value="daw">DAW VST injector MIDI</option>
            <option value="none">Continuous play</option>
          </select>
        </label>
        <span id="wait-hint" className="intent">
          Playback waits at each note group until Space/Enter, WebMIDI, or matching MIDI from a
          Neiro VST insert.
          {targetPitches.length > 0
            ? ` Target ${Math.min(noteIndex + 1, targetPitches.length)}/${targetPitches.length}: MIDI ${targetPitches[Math.min(noteIndex, targetPitches.length - 1)]}.`
            : ''}
        </span>
      </div>

      {file && (
        <audio
          ref={audioRef}
          controls
          loop={looping}
          src={file.audioUrl}
          style={{ width: '100%', marginTop: 12 }}
        />
      )}
      {feedback && (
        <p className="muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  )
}
