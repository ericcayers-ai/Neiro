import { useEffect, useRef, useState } from 'react'
import { editNotes, fetchModels, startTranscribe, type ModelStatus } from '../api/client'
import { useLocalJsonPref, useLocalPref } from '../api/hooks'
import type { TranscribeResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { PlanStrip } from '../components/PlanStrip'
import { TRANSCRIBE_MODES, TRANSCRIBE_MODELS, stemColor } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

function prefersReducedMotion(): boolean {
  try {
    if (document.documentElement.dataset.motion === 'reduce') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function PianoRoll({
  result,
  bloomFx,
}: {
  result: TranscribeResult
  bloomFx: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { file } = useSession()
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const events = Object.entries(result.tracks).flatMap(([track, evs]) =>
      evs.map((e) => ({ ...e, track })),
    )
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = 280
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg0').trim() || '#0e1116'
    ctx.fillRect(0, 0, W, H)
    if (!events.length) {
      ctx.fillStyle = '#98a0ad'
      ctx.font = `${14 * dpr}px sans-serif`
      ctx.fillText('No notes found.', 16 * dpr, 30 * dpr)
      return
    }
    const tMax = Math.max(...events.map((e) => e.offset)) + 0.5
    let pLo = Math.min(...events.map((e) => e.pitch)) - 2
    let pHi = Math.max(...events.map((e) => e.pitch)) + 3
    if (pHi - pLo < 13) {
      const mid = (pHi + pLo) / 2
      pLo = mid - 7
      pHi = mid + 7
    }
    const x = (t: number) => (t / tMax) * W
    const y = (p: number) => H - ((p - pLo) / (pHi - pLo)) * H
    const rowH = H / (pHi - pLo)
    ctx.strokeStyle = '#1f242e'
    ctx.lineWidth = 1
    for (let p = Math.ceil(pLo / 12) * 12; p <= pHi; p += 12) {
      ctx.beginPath()
      ctx.moveTo(0, y(p))
      ctx.lineTo(W, y(p))
      ctx.stroke()
    }
    const beat = 60 / (result.tempo_bpm || 120)
    for (let t = 0; t < tMax; t += beat) {
      ctx.beginPath()
      ctx.moveTo(x(t), 0)
      ctx.lineTo(x(t), H)
      ctx.stroke()
    }
    for (const e of events) {
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, e.confidence)
      ctx.fillStyle = stemColor(e.track)
      const w = Math.max(2, x(e.offset) - x(e.onset) - 1)
      ctx.fillRect(x(e.onset), y(e.pitch) - rowH * 0.9, w, Math.max(2, rowH * 0.8))
    }
    ctx.globalAlpha = 1
    const frame = ctx.getImageData(0, 0, W, H)
    let raf = 0
    const audio = audioRef.current
    const fx = fxRef.current
    const fxCtx = fx?.getContext('2d')
    const allowFx = bloomFx && !prefersReducedMotion()

    const cursor = () => {
      if (!document.body.contains(canvas)) return
      if (audio && !audio.paused) {
        ctx.putImageData(frame, 0, 0)
        ctx.strokeStyle = '#9bb8d4'
        ctx.lineWidth = 2
        const cx = x(audio.currentTime)
        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, H)
        ctx.stroke()
        if (allowFx && fx && fxCtx) {
          fx.width = W
          fx.height = H
          fxCtx.clearRect(0, 0, W, H)
          const g = fxCtx.createRadialGradient(cx, H * 0.45, 2 * dpr, cx, H * 0.45, 90 * dpr)
          g.addColorStop(0, 'rgba(180, 140, 90, 0.28)')
          g.addColorStop(0.45, 'rgba(120, 90, 60, 0.12)')
          g.addColorStop(1, 'rgba(0,0,0,0)')
          fxCtx.fillStyle = g
          fxCtx.fillRect(0, 0, W, H)
          fxCtx.globalAlpha = 0.35
          fxCtx.filter = 'blur(8px)'
          fxCtx.drawImage(canvas, 0, 0)
          fxCtx.filter = 'none'
          fxCtx.globalAlpha = 1
        } else if (fx && fxCtx) {
          fxCtx.clearRect(0, 0, fx.width, fx.height)
        }
      }
      raf = requestAnimationFrame(cursor)
    }
    raf = requestAnimationFrame(cursor)
    return () => cancelAnimationFrame(raf)
  }, [result, file, bloomFx])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [file])

  const play = () => void audioRef.current?.play()
  const pause = () => audioRef.current?.pause()
  const stop = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setPlaying(false)
  }

  return (
    <>
      <div className="piano-roll-wrap">
        <canvas ref={canvasRef} className="piano-roll" aria-label="Piano roll" />
        <canvas ref={fxRef} className="piano-roll-fx" aria-hidden="true" />
      </div>
      <div className="row piano-transport" style={{ marginTop: '0.7rem' }}>
        <button type="button" className="primary" onClick={play} disabled={playing || !file}>
          Play
        </button>
        <button type="button" onClick={pause} disabled={!playing}>
          Pause
        </button>
        <button type="button" onClick={stop} disabled={!file}>
          Stop
        </button>
      </div>
      {file && (
        <audio ref={audioRef} src={file.audioUrl} preload="metadata" style={{ display: 'none' }} />
      )}
    </>
  )
}

function PracticePanel({ focus }: { focus: boolean }) {
  const { file, transcribeResult } = useSession()
  const panelRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!focus || !panelRef.current) return
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panelRef.current.focus()
  }, [focus])

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

  if (!file) return null

  return (
    <div
      ref={panelRef}
      className="practice-panel"
      id="transcribe-practice"
      tabIndex={-1}
      style={{ marginTop: '1.5rem' }}
    >
      <h2>Practice</h2>
      <p className="lede">
        Pitch-preserving speed, loop, count-in, metronome, and wait mode over the session audio
        {transcribeResult ? ' and transcription' : ''}.
      </p>

      {!transcribeResult && (
        <p className="muted">No transcription yet — you can still slow the source audio.</p>
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

function statusLabel(status: string | undefined): string {
  if (status === 'ready') return ''
  if (status === 'needs-download') return ' (needs download)'
  if (status === 'needs-install') return ' (needs install)'
  return status ? ` (${status})` : ''
}

function TranscriptionResultPanel({
  result,
  bloomFx,
  setBloomFx,
  onUpdate,
}: {
  result: TranscribeResult
  bloomFx: boolean
  setBloomFx: (v: boolean) => void
  onUpdate: (r: TranscribeResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const jobId = result.job_id

  const deleteLast = async () => {
    if (!jobId) return
    const track = Object.keys(result.tracks)[0]
    const events = result.tracks[track] || []
    if (!track || !events.length) return
    setBusy(true)
    try {
      const next = await editNotes(jobId, { op: 'delete', track, index: events.length - 1 })
      onUpdate({
        ...result,
        tracks: next.tracks,
        tempo_bpm: next.tempo_bpm,
        event_count: Object.values(next.tracks).reduce((n, t) => n + t.length, 0),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h2>
        Transcription — {result.model}
        {result.used_split ? ' (auto-split)' : ''}
      </h2>
      <label className="field" style={{ marginBottom: '0.5rem' }}>
        <input
          type="checkbox"
          checked={bloomFx && !prefersReducedMotion()}
          disabled={prefersReducedMotion()}
          onChange={(e) => setBloomFx(e.target.checked)}
        />{' '}
        Bloom / liquid playhead FX
        {prefersReducedMotion() ? ' (disabled — reduced motion)' : ' (optional, default off)'}
      </label>
      <PianoRoll result={result} bloomFx={bloomFx} />
      <div className="meta-block">
        {result.event_count} notes · {Math.round(result.tempo_bpm)} BPM
        <div className="export-links" style={{ marginTop: '0.45rem' }}>
          <a href={result.midi_url} download>
            MIDI
          </a>
          {result.musicxml_url && (
            <>
              {' · '}
              <a href={result.musicxml_url} download>
                MusicXML
              </a>
            </>
          )}
          {result.score_svg_url && (
            <>
              {' · '}
              <a href={result.score_svg_url} download>
                Score SVG
                {result.score_renderer === 'placeholder' ? ' (placeholder)' : ''}
              </a>
            </>
          )}
          {result.score_pdf_url && (
            <>
              {' · '}
              <a href={result.score_pdf_url} download>
                Score PDF
              </a>
            </>
          )}
          {result.provenance_url && (
            <>
              {' · '}
              <a href={result.provenance_url} download>
                Provenance
              </a>
            </>
          )}
          {jobId && (
            <>
              {' · '}
              <button type="button" disabled={busy} onClick={() => void deleteLast()}>
                Delete last note
              </button>
            </>
          )}
        </div>
        <br />
        {(result.notes || []).join(' · ')}
      </div>
      {result.svg_url && (
        <div className="score-view" style={{ marginTop: 16 }}>
          <h3>Score</h3>
          <img src={result.svg_url} alt="Rendered score" style={{ maxWidth: '100%' }} />
        </div>
      )}
    </div>
  )
}

export function TranscribeModule() {
  const {
    file,
    setTranscribeResult,
    transcribeResult,
    startEngineJob,
    jobForKind,
    cancelSessionJob,
    practiceFocus,
    clearPracticeFocus,
    analysisCorrections,
  } = useSession()
  const [mode, setMode] = useLocalPref('neiro.tr.mode', 'auto')
  const [model, setModel] = useLocalPref('neiro.tr.model', '')
  const [members, setMembers] = useLocalJsonPref<string[]>('neiro.tr.members', [])
  const [bloomFx, setBloomFx] = useLocalJsonPref('neiro.tr.bloom', false)
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({})
  const job = jobForKind('transcribe')
  const running = job?.status === 'running'
  const selected = TRANSCRIBE_MODES.find((m) => m.value === mode) || TRANSCRIBE_MODES[0]
  const selectedModel = TRANSCRIBE_MODELS.find((m) => m.value === model) || TRANSCRIBE_MODELS[0]
  const ensembleMode = mode === 'ensemble' || model === 'tr-ensemble-default' || members.length >= 2

  useEffect(() => {
    let alive = true
    void fetchModels('transcribe')
      .then((list) => {
        if (!alive) return
        const map: Record<string, ModelStatus> = {}
        for (const m of list) map[m.id] = m
        setModelStatus(map)
      })
      .catch(() => {
        /* engine may be down — leave status empty */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!practiceFocus) return
    const t = window.setTimeout(() => clearPracticeFocus(), 800)
    return () => window.clearTimeout(t)
  }, [practiceFocus, clearPracticeFocus])

  const toggleMember = (id: string) => {
    setMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const run = async () => {
    if (!file) return
    if (model === 'whisper-lyrics') {
      // Honest: Whisper is lyrics ASR, not a MIDI decoder.
      window.alert(
        'Whisper lyrics produces synced text, not MIDI. Pick a note decoder (or ensemble) for piano-roll transcription.',
      )
      return
    }
    const useEnsemble = ensembleMode && (members.length >= 2 || model === 'tr-ensemble-default')
    const memberList = useEnsemble && members.length >= 2 ? members : undefined
    const done = await startEngineJob({
      kind: 'transcribe',
      label: useEnsemble
        ? `Transcribe · ensemble${memberList ? ` · ${memberList.length} members` : ''}`
        : `Transcribe · ${mode}${model ? ` · ${model}` : ''}`,
      module: 'transcribe',
      startFn: () =>
        startTranscribe(file.fileId, useEnsemble ? 'ensemble' : mode, model || undefined, {
          members: memberList,
          ensemble: useEnsemble && !memberList,
          corrections: analysisCorrections,
        }),
    })
    if (done?.status === 'done' && done.result) {
      setTranscribeResult(done.result as TranscribeResult)
    }
  }

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Transcribe</h2>
        <div className="gate muted">Import a file first.</div>
      </div>
    )
  }

  const memberChoices = TRANSCRIBE_MODELS.filter((m) => m.ensembleMember)

  return (
    <div className="module-panel">
      <h2>Transcribe</h2>
      <p className="lede">
        Produce MIDI and a piano-roll preview for <strong>{file.name}</strong>. Multi-select
        decoders and ensemble mode fuse with hybrid vote when ≥2 members are installed.
      </p>

      <div className="row">
        <IntentField label="Mode" intent={selected.intent} htmlFor="tr-mode">
          <select
            id="tr-mode"
            value={mode}
            disabled={running}
            onChange={(e) => setMode(e.target.value)}
          >
            {TRANSCRIBE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </IntentField>
        <IntentField label="Model" intent={selectedModel.intent} htmlFor="tr-model">
          <select
            id="tr-model"
            value={model}
            disabled={running}
            onChange={(e) => setModel(e.target.value)}
          >
            {TRANSCRIBE_MODELS.map((m) => {
              const st = m.value ? modelStatus[m.value]?.status : undefined
              const disabled =
                !!m.value &&
                !!st &&
                st !== 'ready' &&
                m.value !== 'tr-ensemble-default' &&
                !m.lyricsOnly
              return (
                <option key={m.value || 'default'} value={m.value} disabled={disabled && st === 'needs-install'}>
                  {m.label}
                  {statusLabel(st)}
                  {m.lyricsOnly ? ' — lyrics only' : ''}
                </option>
              )
            })}
          </select>
        </IntentField>
        <button
          type="button"
          className="primary"
          disabled={running}
          onClick={() => void run()}
          title="Start transcription"
        >
          Transcribe
        </button>
      </div>

      <div className="ensemble-members" style={{ marginTop: '0.85rem' }}>
        <IntentField
          label="Ensemble members"
          intent="Select two or more installed decoders for hybrid vote. Empty + ensemble mode uses tr-ensemble-default."
        >
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
            {memberChoices.map((m) => {
              const st = modelStatus[m.value]?.status
              const ready = !st || st === 'ready' || st === 'needs-download'
              return (
                <label key={m.value} className="field" style={{ flexDirection: 'row', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={members.includes(m.value)}
                    disabled={running || st === 'needs-install'}
                    onChange={() => toggleMember(m.value)}
                  />
                  <span>
                    {m.label}
                    {!ready ? statusLabel(st) : st === 'needs-download' ? ' (needs download)' : ''}
                  </span>
                </label>
              )
            })}
          </div>
        </IntentField>
      </div>

      <PlanStrip kind="transcribe" fileId={file.fileId} mode={mode} />

      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />

      {transcribeResult && (
        <TranscriptionResultPanel
          result={transcribeResult}
          bloomFx={bloomFx}
          setBloomFx={setBloomFx}
          onUpdate={setTranscribeResult}
        />
      )}

      <PracticePanel focus={practiceFocus} />
    </div>
  )
}
