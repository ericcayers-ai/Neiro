import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyEdit,
  exportUrl,
  fetchSpectrogram,
  fetchWaveform,
  type EditOp,
} from '../api/client'
import type { WaveformData } from '../api/types'
import { EXPORT_FORMATS, fmtTimecode } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

interface Sel {
  start: number
  end: number
}

const TOOLS: { op: EditOp; label: string; intent: string; db?: number; needsSel?: boolean }[] = [
  { op: 'trim', label: 'Trim', intent: 'Keep only the selection; discard the rest.', needsSel: true },
  { op: 'delete', label: 'Delete', intent: 'Remove the selection and splice the gap.', needsSel: true },
  { op: 'silence', label: 'Silence', intent: 'Zero the selection; keep duration.', needsSel: true },
  { op: 'fade_in', label: 'Fade in', intent: 'Fade the selection from silence to full.', needsSel: true },
  { op: 'fade_out', label: 'Fade out', intent: 'Fade the selection from full to silence.', needsSel: true },
  { op: 'gain', label: 'Gain +3', intent: 'Raise level by 3 dB (selection if set).', db: 3 },
  { op: 'gain', label: 'Gain −3', intent: 'Lower level by 3 dB (selection if set).', db: -3 },
  { op: 'normalize', label: 'Normalize', intent: 'Peak-normalize the whole file to −1 dBFS.' },
  { op: 'reverse', label: 'Reverse', intent: 'Reverse the whole file in time.' },
]

function drawWave(canvas: HTMLCanvasElement, wave: WaveformData) {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = 160
  canvas.width = cssW * dpr
  canvas.height = cssH * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#0e1116'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#1f242e'
  ctx.beginPath()
  ctx.moveTo(0, H / 2)
  ctx.lineTo(W, H / 2)
  ctx.stroke()
  ctx.fillStyle = '#56B4E9'
  const n = wave.width
  for (let i = 0; i < n; i++) {
    const x = (i / n) * W
    const y1 = H / 2 - wave.max[i] * (H / 2) * 0.95
    const y2 = H / 2 - wave.min[i] * (H / 2) * 0.95
    ctx.fillRect(x, y1, Math.max(1, W / n), Math.max(1, y2 - y1))
  }
}

function drawSpec(
  canvas: HTMLCanvasElement,
  data: { cols: number; rows: number; data: number[] },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = data.cols
  canvas.height = data.rows
  const img = ctx.createImageData(data.cols, data.rows)
  for (let i = 0; i < data.data.length; i++) {
    const t = data.data[i] / 255
    img.data[i * 4] = Math.min(255, 40 + t * 260)
    img.data[i * 4 + 1] = Math.max(0, t * 200 - 30)
    img.data[i * 4 + 2] = Math.max(0, 90 - t * 90) + (t > 0.8 ? (t - 0.8) * 800 : 0)
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  canvas.style.height = '160px'
  canvas.style.width = '100%'
}

export function StudioModule() {
  const { file, studioTarget, clearStudioTarget, setFile } = useSession()
  const [fileId, setFileId] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string>('')
  const [name, setName] = useState('audio')
  const [duration, setDuration] = useState(0)
  const [sel, setSel] = useState<Sel | null>(null)
  const [undoStack, setUndoStack] = useState<{ id: string; url: string; duration: number }[]>([])
  const [redoStack, setRedoStack] = useState<{ id: string; url: string; duration: number }[]>([])
  const [playing, setPlaying] = useState(false)
  const [loopSel, setLoopSel] = useState(false)
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [status, setStatus] = useState('')
  const [visualError, setVisualError] = useState('')
  const [visualLoading, setVisualLoading] = useState(false)
  const [exportFmt, setExportFmt] = useState<'wav16' | 'wav24' | 'flac'>('wav24')
  const [audioEpoch, setAudioEpoch] = useState(0)

  const waveRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dragging: boolean; startX: number }>({ dragging: false, startX: 0 })
  const [playheadPct, setPlayheadPct] = useState<number | null>(null)

  const viewDur = Math.max(0.001, (viewEnd || duration) - viewStart)

  const xToTime = useCallback(
    (clientX: number) => {
      const c = waveRef.current
      if (!c) return 0
      const r = c.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      return viewStart + frac * viewDur
    },
    [viewStart, viewDur],
  )

  const loadVisuals = useCallback(
    async (id: string, fullDuration?: number) => {
      setVisualLoading(true)
      setVisualError('')
      try {
        const width = Math.min(4000, Math.max(800, (waveRef.current?.clientWidth || 1200) * 2))
        const vs = viewStart
        const ve = viewEnd || fullDuration || 0
        const range =
          fullDuration && ve > 0 && (vs > 0.01 || ve < fullDuration - 0.01)
            ? { start: vs, end: ve }
            : undefined
        const wave = await fetchWaveform(id, width, range)
        setDuration(wave.duration)
        if (!viewEnd) setViewEnd(wave.duration)
        if (waveRef.current) drawWave(waveRef.current, wave)
        const spec = await fetchSpectrogram(id)
        if (specRef.current) drawSpec(specRef.current, spec)
      } catch (err) {
        setVisualError(err instanceof Error ? err.message : String(err))
      } finally {
        setVisualLoading(false)
      }
    },
    [viewStart, viewEnd],
  )

  const remountAudio = useCallback((id: string, url: string, dur: number) => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    setFileId(id)
    setAudioUrl(url)
    setDuration(dur)
    setViewStart(0)
    setViewEnd(dur > 0 ? dur : 0)
    setAudioEpoch((n) => n + 1)
    setPlaying(false)
    setPlayheadPct(null)
  }, [])

  // Bind session / Studio target
  useEffect(() => {
    if (studioTarget) {
      setFileId(studioTarget.fileId)
      setAudioUrl(studioTarget.audioUrl)
      setName(studioTarget.name)
      setUndoStack([])
      setRedoStack([])
      setSel(null)
      setViewStart(0)
      setViewEnd(0)
      clearStudioTarget()
    } else if (file && !fileId) {
      setFileId(file.fileId)
      setAudioUrl(file.audioUrl)
      setName(file.name)
      setViewStart(0)
      setViewEnd(0)
    }
  }, [studioTarget, file, fileId, clearStudioTarget])

  useEffect(() => {
    if (!fileId) return
    void loadVisuals(fileId)
  }, [fileId, loadVisuals])

  // Playhead RAF
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      if (a && !a.paused && duration > 0) {
        const t = a.currentTime
        if (loopSel && sel && t >= sel.end) {
          a.currentTime = sel.start
        }
        const pct = ((t - viewStart) / viewDur) * 100
        setPlayheadPct(pct >= 0 && pct <= 100 ? pct : null)
        setPlaying(true)
      } else {
        setPlaying(false)
        if (!a || a.paused) setPlayheadPct(null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [duration, loopSel, sel, viewStart, viewDur])

  const hasSel = !!sel && Math.abs(sel.end - sel.start) >= 0.01

  const runEdit = async (op: EditOp, db?: number) => {
    if (!fileId) return
    const needsSel = ['trim', 'delete', 'silence', 'fade_in', 'fade_out'].includes(op)
    if (needsSel && !hasSel) {
      setStatus('Select a region first.')
      return
    }
    const body: Parameters<typeof applyEdit>[0] = { file_id: fileId, op }
    if (needsSel && sel) {
      body.start = sel.start
      body.end = sel.end
    }
    if (op === 'gain') {
      body.db = db ?? 0
      if (hasSel && sel) {
        body.start = sel.start
        body.end = sel.end
      }
    }
    try {
      const data = await applyEdit(body)
      setUndoStack((s) => [...s, { id: fileId, url: audioUrl, duration }])
      setRedoStack([])
      remountAudio(data.file_id, data.audio_url, data.duration)
      if (waveRef.current) drawWave(waveRef.current, data.waveform)
      try {
        const spec = await fetchSpectrogram(data.file_id)
        if (specRef.current) drawSpec(specRef.current, spec)
      } catch (err) {
        setVisualError(err instanceof Error ? err.message : String(err))
      }
      setSel(null)
      setStatus(`Applied ${op}`)
      if (file && file.fileId === fileId) {
        setFile({ ...file, fileId: data.file_id, audioUrl: data.audio_url })
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const undo = () => {
    if (!undoStack.length || !fileId) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, { id: fileId, url: audioUrl, duration }])
    setUndoStack((s) => s.slice(0, -1))
    remountAudio(prev.id, prev.url, prev.duration)
    if (file) {
      setFile({ ...file, fileId: prev.id, audioUrl: prev.url })
    }
    setStatus('Undid last edit')
  }

  const redo = () => {
    if (!redoStack.length || !fileId) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, { id: fileId, url: audioUrl, duration }])
    setRedoStack((s) => s.slice(0, -1))
    remountAudio(next.id, next.url, next.duration)
    if (file) {
      setFile({ ...file, fileId: next.id, audioUrl: next.url })
    }
    setStatus('Redid edit')
  }

  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      if (hasSel && sel && a.currentTime < sel.start) a.currentTime = sel.start
      void a.play()
    } else a.pause()
  }

  const stopToStart = () => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    a.currentTime = hasSel && sel ? sel.start : 0
  }

  // Pointer selection + scrub
  useEffect(() => {
    const c = waveRef.current
    if (!c) return
    const onDown = (e: PointerEvent) => {
      dragRef.current = { dragging: true, startX: e.clientX }
      const t = xToTime(e.clientX)
      setSel({ start: t, end: t })
      c.setPointerCapture(e.pointerId)
      if (audioRef.current) audioRef.current.currentTime = t
    }
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.dragging) return
      let a = xToTime(dragRef.current.startX)
      let b = xToTime(e.clientX)
      if (a > b) [a, b] = [b, a]
      setSel({ start: a, end: b })
    }
    const onUp = () => {
      dragRef.current.dragging = false
    }
    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerup', onUp)
    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerup', onUp)
    }
  }, [xToTime])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'Escape') {
        setSel(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel) {
        e.preventDefault()
        void runEdit(e.shiftKey ? 'delete' : 'silence')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === '[') {
        setSel((s) =>
          s ? { start: Math.max(0, s.start - 0.05), end: Math.max(0.05, s.end - 0.05) } : s,
        )
      } else if (e.key === ']') {
        setSel((s) =>
          s
            ? {
                start: Math.min(duration - 0.05, s.start + 0.05),
                end: Math.min(duration, s.end + 0.05),
              }
            : s,
        )
      } else if (e.key === '=' || e.key === '+') {
        // zoom in around selection or center
        const mid = hasSel && sel ? (sel.start + sel.end) / 2 : viewStart + viewDur / 2
        const half = viewDur / 4
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(duration, mid + half))
      } else if (e.key === '-') {
        const mid = viewStart + viewDur / 2
        const half = Math.min(duration / 2, viewDur)
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(duration, mid + half))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSel, sel, duration, viewStart, viewDur, fileId, audioUrl])

  // Wheel zoom/pan
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      if (!duration) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const mid = viewStart + viewDur / 2
        const factor = e.deltaY > 0 ? 1.25 : 0.8
        const half = Math.max(0.05, (viewDur * factor) / 2)
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(duration, mid + half))
      } else {
        const shift = (e.deltaY || e.deltaX) * 0.001 * viewDur
        const start = Math.max(0, Math.min(duration - viewDur, viewStart + shift))
        setViewStart(start)
        setViewEnd(start + viewDur)
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [duration, viewStart, viewDur])

  useEffect(() => {
    if (fileId && duration > 0) void loadVisuals(fileId, duration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart, viewEnd])

  if (!fileId) {
    return (
      <div className="module-panel">
        <h2>Studio</h2>
        <div className="gate muted">Import a file (or open a stem) to edit.</div>
      </div>
    )
  }

  const selLeft =
    hasSel && sel ? ((sel.start - viewStart) / viewDur) * 100 : 0
  const selWidth =
    hasSel && sel ? ((sel.end - sel.start) / viewDur) * 100 : 0

  const exportIntent = EXPORT_FORMATS.find((f) => f.id === exportFmt)?.intent || ''

  return (
    <div className="module-panel bleed">
      <h2>Studio — {name}</h2>
      <p className="lede">
        Waveform and spectrogram editor. Edits write new artifacts (non-destructive). Shortcuts:
        Space play/pause · Del silence · Shift+Del delete · Ctrl+Z / Ctrl+Y · [ ] nudge · Esc clear ·
        scroll pan · Ctrl+scroll zoom.
      </p>

      <div className="studio-toolbar">
        {TOOLS.map((t) => (
          <div className="tool" key={t.label}>
            <button type="button" onClick={() => void runEdit(t.op, t.db)} title={t.intent}>
              {t.label}
            </button>
            <span className="intent">{t.intent}</span>
          </div>
        ))}
        <div className="tool">
          <button type="button" disabled={!undoStack.length} onClick={undo} title="Undo last edit">
            Undo
          </button>
          <span className="intent">Restore the previous edit revision.</span>
        </div>
        <div className="tool">
          <button type="button" disabled={!redoStack.length} onClick={redo} title="Redo">
            Redo
          </button>
          <span className="intent">Re-apply an undone edit.</span>
        </div>
      </div>

      {(visualLoading || visualError) && (
        <p className={visualError ? 'error-text' : 'muted'} role="status">
          {visualError || 'Loading waveform and spectrogram…'}
        </p>
      )}

      <div className="studio-canvases" ref={wrapRef}>
        <canvas ref={waveRef} height={160} aria-label="Waveform" />
        <canvas ref={specRef} height={160} aria-label="Spectrogram" />
        {hasSel && (
          <div
            className="studio-overlay studio-sel"
            style={{ left: `${selLeft}%`, width: `${Math.max(0.2, selWidth)}%` }}
          />
        )}
        {playheadPct != null && (
          <div className="studio-overlay studio-playhead" style={{ left: `${playheadPct}%` }} />
        )}
      </div>

      <div className="studio-transport">
        <button type="button" onClick={togglePlay} title="Play or pause (Space)">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={stopToStart} title="Stop and return to selection start or zero">
          Stop
        </button>
        <button
          type="button"
          className={loopSel ? 'active' : ''}
          onClick={() => setLoopSel((v) => !v)}
          title="Loop playback inside the selection"
        >
          Loop selection
        </button>
        <span className="intent" style={{ margin: 0 }}>
          Loop when a region is selected; otherwise ignored.
        </span>
        <span className="studio-times">
          {fmtTimecode(audioRef.current?.currentTime || 0)}
          {hasSel && sel
            ? ` · sel ${fmtTimecode(sel.start)}–${fmtTimecode(sel.end)} (${(sel.end - sel.start).toFixed(2)}s)`
            : ' · no selection'}
          {` · ${fmtTimecode(duration)}`}
        </span>
        <audio key={audioEpoch} ref={audioRef} src={audioUrl} preload="auto" />
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="field">
          <label htmlFor="export-fmt">Export format</label>
          <select
            id="export-fmt"
            value={exportFmt}
            onChange={(e) => setExportFmt(e.target.value as typeof exportFmt)}
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="intent">{exportIntent}</span>
        </div>
        <a
          className="primary"
          href={exportUrl(fileId, exportFmt)}
          download
          style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 4, alignSelf: 'flex-end' }}
          title="Download the current Studio buffer"
        >
          Download
        </a>
      </div>

      {status && <p className="status-line muted">{status}</p>}
    </div>
  )
}
