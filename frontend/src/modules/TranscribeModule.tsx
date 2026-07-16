import { useEffect, useRef, useState } from 'react'
import { editNotes, startTranscribe } from '../api/client'
import { useJobPoller, useLocalPref } from '../api/hooks'
import type { MidiEvent, TranscribeResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { PlanStrip } from '../components/PlanStrip'
import { TRANSCRIBE_MODES, TRANSCRIBE_MODELS, stemColor } from '../constants/options'
import { useSession } from '../state/session'
import { drawWebGLPianoRoll, type PianoRollNote } from '../viz/webgl'
import './modules.css'

type RollEvent = MidiEvent & { track: string; color: string }

function cssToken(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function pianoRollColors() {
  return {
    background: cssToken('--bg0', '#0e1116'),
    grid: cssToken('--line', '#1f242e'),
    playhead: cssToken('--accent-hot', '#9bb8d4'),
  }
}

function drawPianoRollCanvas(
  canvas: HTMLCanvasElement,
  result: TranscribeResult,
  events: RollEvent[],
  playheadTime?: number | null,
): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = 280
  canvas.width = cssW * dpr
  canvas.height = cssH * dpr
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = pianoRollColors().background
  ctx.fillRect(0, 0, W, H)
  if (!events.length) {
    ctx.fillStyle = '#98a0ad'
    ctx.font = `${14 * dpr}px sans-serif`
    ctx.fillText('No notes found.', 16 * dpr, 30 * dpr)
    return true
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
  ctx.strokeStyle = pianoRollColors().grid
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
    ctx.fillStyle = e.color
    const w = Math.max(2, x(e.offset) - x(e.onset) - 1)
    ctx.fillRect(x(e.onset), y(e.pitch) - rowH * 0.9, w, Math.max(2, rowH * 0.8))
  }
  ctx.globalAlpha = 1
  if (playheadTime != null) {
    ctx.strokeStyle = pianoRollColors().playhead
    ctx.lineWidth = 2
    const cx = x(playheadTime)
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, H)
    ctx.stroke()
  }
  return true
}

function PianoRoll({ result }: { result: TranscribeResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { file } = useSession()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const events = Object.entries(result.tracks).flatMap(([track, evs]) =>
      evs.map((e) => ({ ...e, track, color: stemColor(track) })),
    )
    if (!events.length) {
      drawPianoRollCanvas(canvas, result, events)
      return
    }

    const notes: PianoRollNote[] = events.map((e) => ({
      onset: e.onset,
      offset: e.offset,
      pitch: e.pitch,
      confidence: e.confidence,
      color: e.color,
    }))
    let useWebGL = drawWebGLPianoRoll(canvas, notes, {
      ...pianoRollColors(),
      tempoBpm: result.tempo_bpm,
    })
    if (!useWebGL) drawPianoRollCanvas(canvas, result, events)

    let raf = 0
    let hadPlayhead = false
    const audio = audioRef.current
    const cursor = () => {
      if (!document.body.contains(canvas)) return
      const playheadTime = audio && !audio.paused ? audio.currentTime : null
      if (useWebGL) {
        if (playheadTime != null) {
          useWebGL = drawWebGLPianoRoll(canvas, notes, {
            ...pianoRollColors(),
            tempoBpm: result.tempo_bpm,
            playheadTime,
          })
          hadPlayhead = true
        } else if (hadPlayhead) {
          useWebGL = drawWebGLPianoRoll(canvas, notes, {
            ...pianoRollColors(),
            tempoBpm: result.tempo_bpm,
          })
          hadPlayhead = false
        }
      } else if (playheadTime != null) {
        drawPianoRollCanvas(canvas, result, events, playheadTime)
        hadPlayhead = true
      } else if (hadPlayhead) {
        drawPianoRollCanvas(canvas, result, events)
        hadPlayhead = false
      }
      raf = requestAnimationFrame(cursor)
    }
    raf = requestAnimationFrame(cursor)
    return () => cancelAnimationFrame(raf)
  }, [result, file])

  return (
    <>
      <canvas ref={canvasRef} className="piano-roll" aria-label="Piano roll" />
      {file && <audio ref={audioRef} controls src={file.audioUrl} style={{ width: '100%', marginTop: 10 }} />}
    </>
  )
}

export function TranscribeModule() {
  const {
    file,
    setTranscribeResult,
    transcribeResult,
    setJobRunning,
    setJobLabel,
    registerCancel,
    workspaceMode,
  } = useSession()
  const [mode, setMode] = useLocalPref('neiro.tr.mode', 'auto')
  const [model, setModel] = useLocalPref('neiro.tr.model', '')
  const job = useJobPoller()
  const selected = TRANSCRIBE_MODES.find((m) => m.value === mode) || TRANSCRIBE_MODES[0]
  const selectedModel = TRANSCRIBE_MODELS.find((m) => m.value === model) || TRANSCRIBE_MODELS[0]

  useEffect(() => {
    setJobRunning(job.running)
    setJobLabel(job.running ? `Transcribe · ${mode}${model ? ` · ${model}` : ''}` : null)
    registerCancel(job.running ? () => void job.cancel() : null)
    return () => {
      registerCancel(null)
      setJobRunning(false)
      setJobLabel(null)
    }
  }, [job.running, job.cancel, mode, model, registerCancel, setJobRunning, setJobLabel])

  const run = async () => {
    if (!file) return
    const done = await job.start('transcribe', () =>
      startTranscribe(file.fileId, mode, model || undefined),
    )
    if (done?.status === 'done' && done.result) {
      const result = done.result as TranscribeResult
      if (!result.job_id && done) {
        // job poller may expose id separately; keep whatever the engine returned
      }
      setTranscribeResult(result)
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

  return (
    <div className="module-panel">
      <h2>Transcribe</h2>
      <p className="lede">
        Produce MIDI and a piano-roll preview for <strong>{file.name}</strong>.
      </p>

      <div className="row">
        <IntentField label="Mode" intent={selected.intent} htmlFor="tr-mode">
          <select
            id="tr-mode"
            value={mode}
            disabled={job.running}
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
            disabled={job.running}
            onChange={(e) => setModel(e.target.value)}
          >
            {TRANSCRIBE_MODELS.map((m) => (
              <option key={m.value || 'default'} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </IntentField>
        <button
          type="button"
          className="primary"
          disabled={job.running}
          onClick={() => void run()}
          title="Start transcription"
        >
          Transcribe
        </button>
      </div>

      {workspaceMode === 'advanced' && (
        <PlanStrip kind="transcribe" fileId={file.fileId} mode={mode} />
      )}

      <JobProgress status={job.status} error={job.error} onCancel={() => void job.cancel()} />

      {transcribeResult && (
        <TranscriptionResultPanel
          result={transcribeResult}
          onUpdate={(next) => setTranscribeResult(next)}
        />
      )}
    </div>
  )
}

function TranscriptionResultPanel({
  result,
  onUpdate,
}: {
  result: TranscribeResult
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
    <div style={{ marginTop: 20 }}>
      <h2>
        Transcription — {result.model}
        {result.used_split ? ' (auto-split)' : ''}
      </h2>
      <PianoRoll result={result} />
      <div className="meta-block">
        {result.event_count} notes · {Math.round(result.tempo_bpm)} BPM ·{' '}
        <a href={result.midi_url} download>
          download MIDI
        </a>
        {jobId && (
          <>
            {' · '}
            <button type="button" disabled={busy} onClick={() => void deleteLast()}>
              Delete last note
            </button>
          </>
        )}
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
