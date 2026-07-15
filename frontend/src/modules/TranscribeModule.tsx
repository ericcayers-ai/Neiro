import { useEffect, useRef } from 'react'
import { startTranscribe } from '../api/client'
import { useJobPoller, useLocalPref } from '../api/hooks'
import type { TranscribeResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { TRANSCRIBE_MODES, TRANSCRIBE_MODELS, stemColor } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

function PianoRoll({ result }: { result: TranscribeResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { file } = useSession()

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

      <JobProgress status={job.status} error={job.error} onCancel={() => void job.cancel()} />

      {transcribeResult && (
        <div style={{ marginTop: 20 }}>
          <h2>
            Transcription — {transcribeResult.model}
            {transcribeResult.used_split ? ' (auto-split)' : ''}
          </h2>
          <PianoRoll result={transcribeResult} />
          <div className="meta-block">
            {transcribeResult.event_count} notes · {Math.round(transcribeResult.tempo_bpm)} BPM ·{' '}
            <a href={transcribeResult.midi_url} download>
              download MIDI
            </a>
            <br />
            {(transcribeResult.notes || []).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}
