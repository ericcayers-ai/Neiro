import { useEffect, useRef, useState } from 'react'
import { timeStretchFile } from '../../api/client'
import { useChromeCollapsed } from '../../hooks/useChromeCollapsed'
import { useDawBridge } from '../../hooks/useDawBridge'
import { IconChevronDown, IconChevronRight } from '../../icons'
import { useSession } from '../../state/session'
import { startPhaseLockedMetronome, type MetronomeHandle } from './metronome'

/**
 * Practice mode — Rubber Band pitch-preserving speed when possible,
 * wait modes from Learn (key / WebMIDI / DAW), BPM-synced metro/loop/count-in.
 */
export function MidiPracticePanel({ focus }: { focus: boolean }) {
  const { file, transcribeResult, setModule } = useSession()
  const [collapsed, setCollapsed] = useChromeCollapsed('neiro.practice.midi.collapsed', false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [metronome, setMetronome] = useState(false)
  const [waitMode, setWaitMode] = useState<'key' | 'webmidi' | 'daw' | 'none'>('key')
  const [feedback, setFeedback] = useState('')
  const [noteIndex, setNoteIndex] = useState(0)
  const [stretchUrl, setStretchUrl] = useState<string | null>(null)
  const [stretchBusy, setStretchBusy] = useState(false)
  const [stretchNote, setStretchNote] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const noteIndexRef = useRef(0)
  const pitchesRef = useRef<number[]>([])
  const waitModeRef = useRef(waitMode)
  const metroRef = useRef<MetronomeHandle | null>(null)
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
    if (!focus || !panelRef.current) return
    setCollapsed(false)
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panelRef.current.focus()
  }, [focus, setCollapsed])

  // Rubber Band / engine time_stretch cache for common rates (rate = duration scale).
  useEffect(() => {
    if (!file || Math.abs(speed - 1) < 0.02) {
      setStretchUrl(null)
      setStretchNote('')
      return
    }
    let cancelled = false
    const rate = 1 / speed // duration scale: slower speed → longer audio
    setStretchBusy(true)
    setStretchNote('Building pitch-preserving stretch…')
    void timeStretchFile(file.fileId, rate)
      .then((res) => {
        if (cancelled) return
        setStretchUrl(res.audio_url)
        setStretchNote('Pitch-preserving stretch ready')
      })
      .catch((err) => {
        if (cancelled) return
        setStretchUrl(null)
        setStretchNote(
          `Stretch unavailable (${err instanceof Error ? err.message : String(err)}) — using playbackRate`,
        )
        if (audioRef.current) audioRef.current.playbackRate = speed
      })
      .finally(() => {
        if (!cancelled) setStretchBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [file?.fileId, speed])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    // When using stretched URL, keep rate at 1; otherwise browser playbackRate.
    el.playbackRate = stretchUrl ? 1 : speed
  }, [speed, stretchUrl])

  useEffect(() => {
    if (!metronome) {
      metroRef.current?.stop()
      metroRef.current = null
      return
    }
    const bpm = (transcribeResult?.tempo_bpm || file?.report?.estimated_bpm || 100) * speed
    const audio = audioRef.current
    const playhead = audio?.currentTime ?? 0
    const ctx = new AudioContext()
    metroRef.current = startPhaseLockedMetronome({
      bpm,
      playheadSec: playhead,
      audioNow: ctx.currentTime,
      downbeatSec: 0,
      context: ctx,
    })
    return () => {
      metroRef.current?.stop()
      metroRef.current = null
      void ctx.close()
    }
  }, [metronome, speed, transcribeResult?.tempo_bpm, file?.report?.estimated_bpm])

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
      <div className="gate">
        <div className="gate-title">Practice</div>
        <p className="gate-body">
          Import (and optionally transcribe) a track — or open the Neiro VST injector from your DAW.
        </p>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div ref={panelRef} className="practice-panel is-collapsed" id="midi-practice" tabIndex={-1}>
        <button
          type="button"
          className="chrome-collapse-toggle ghost icon-btn"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Show practice panel"
          title="Show practice"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    )
  }

  const src = stretchUrl || file?.audioUrl

  return (
    <div ref={panelRef} className="practice-panel" id="midi-practice" tabIndex={-1}>
      <div className="practice-panel-head">
        <h2>Practice</h2>
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => setCollapsed(true)}
          aria-expanded
          aria-label="Hide practice panel"
          title="Hide practice"
        >
          <IconChevronDown size={16} />
        </button>
      </div>
      <p className="lede">
        Pitch-preserving speed (Rubber Band when available), loop, count-in, metronome, and wait
        mode{transcribeResult ? ' over the transcription' : ''}.
      </p>

      {dawConnected && dawStatus && (
        <div className="gate" role="status" aria-live="polite">
          <div className="gate-title">DAW bridge active</div>
          <p className="gate-body">
            {dawStatus.instance_count} injector
            {dawStatus.instance_count === 1 ? '' : 's'}; focused{' '}
            {dawStatus.focus_instance || 'none'}.
          </p>
        </div>
      )}

      {!transcribeResult && (
        <div className="gate">
          <div className="gate-title">No transcription yet</div>
          <p className="gate-body">You can still slow the source audio, or run Transcribe first.</p>
          <button type="button" onClick={() => setModule('midi')}>
            Open Transcribe mode
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
        <button type="button" className={looping ? 'active' : ''} onClick={() => setLooping((v) => !v)}>
          Loop section
        </button>
        <button type="button" className={countIn ? 'active' : ''} onClick={() => setCountIn((v) => !v)}>
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
      {(stretchBusy || stretchNote) && (
        <p className="muted" role="status">
          {stretchBusy ? 'Building stretch…' : stretchNote}
        </p>
      )}

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
          Playback waits at each note until Space/Enter, WebMIDI, or matching MIDI from a Neiro VST
          insert.
          {targetPitches.length > 0
            ? ` Target ${Math.min(noteIndex + 1, targetPitches.length)}/${targetPitches.length}: MIDI ${targetPitches[Math.min(noteIndex, targetPitches.length - 1)]}.`
            : ''}
        </span>
      </div>

      {src && (
        <audio
          ref={audioRef}
          controls
          loop={looping}
          src={src}
          key={src}
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
