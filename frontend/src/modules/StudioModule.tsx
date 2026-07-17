import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyEdit,
  bounceTracks,
  exportUrl,
  fetchWaveform,
  uploadFile,
  type EditOp,
} from '../api/client'
import type { WaveformData } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { EXPORT_FORMATS, fmtTimecode, stemColor } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

type ToolMode = 'select' | 'scrub' | 'split'

interface Clip {
  id: string
  sourceStart: number
  sourceEnd: number
  offset: number
}

interface Track {
  id: string
  name: string
  fileId: string
  audioUrl: string
  color: string
  mute: boolean
  solo: boolean
  gain: number
  pan: number
  duration: number
  clips: Clip[]
}

interface Sel {
  trackId: string
  start: number
  end: number
}

interface Snap {
  tracks: Track[]
  selectedIds: string[]
}

const MODE_INTENT: Record<ToolMode, string> = {
  select: 'Drag on a lane to select a region for trim, silence, delete, or fades.',
  scrub: 'Click or drag to move the playhead without creating a selection.',
  split: 'Click a clip to cut it into two at that time.',
}

const EDIT_TOOLS: {
  op: EditOp
  label: string
  title: string
  intent: string
  db?: number
  needsSel?: boolean
}[] = [
  { op: 'trim', label: 'Trim', title: 'Trim', intent: 'Keep only the selection.', needsSel: true },
  { op: 'delete', label: 'Cut', title: 'Delete / splice', intent: 'Remove selection and close the gap.', needsSel: true },
  { op: 'silence', label: 'Mute', title: 'Silence', intent: 'Zero the selection; keep duration.', needsSel: true },
  { op: 'fade_in', label: 'In', title: 'Fade in', intent: 'Fade selection from silence to full.', needsSel: true },
  { op: 'fade_out', label: 'Out', title: 'Fade out', intent: 'Fade selection from full to silence.', needsSel: true },
  { op: 'gain', label: '+3', title: 'Gain +3 dB', intent: 'Raise level by 3 dB.', db: 3 },
  { op: 'gain', label: '−3', title: 'Gain −3 dB', intent: 'Lower level by 3 dB.', db: -3 },
  { op: 'normalize', label: 'Norm', title: 'Normalize', intent: 'Peak-normalize to −1 dBFS.' },
  { op: 'reverse', label: 'Rev', title: 'Reverse', intent: 'Reverse the selected track.' },
]

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function trackFromFile(
  name: string,
  fileId: string,
  audioUrl: string,
  duration = 0,
): Track {
  return {
    id: uid('trk'),
    name,
    fileId,
    audioUrl,
    color: stemColor(name),
    mute: false,
    solo: false,
    gain: 1,
    pan: 0,
    duration,
    clips: [
      {
        id: uid('clip'),
        sourceStart: 0,
        sourceEnd: duration || 0,
        offset: 0,
      },
    ],
  }
}

function drawLane(canvas: HTMLCanvasElement, wave: WaveformData, color: string) {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = 56
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
  ctx.fillStyle = color
  const n = wave.width
  for (let i = 0; i < n; i++) {
    const x = (i / n) * W
    const y1 = H / 2 - wave.max[i] * (H / 2) * 0.92
    const y2 = H / 2 - wave.min[i] * (H / 2) * 0.92
    ctx.fillRect(x, y1, Math.max(1, W / n), Math.max(1, y2 - y1))
  }
}

export function StudioModule() {
  const {
    file,
    studioTarget,
    clearStudioTarget,
    setFile,
    separateResult,
    studioMixOpen,
    setStudioMixOpen,
    setModule,
  } = useSession()

  const [tracks, setTracks] = useState<Track[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mode, setMode] = useState<ToolMode>('select')
  const [sel, setSel] = useState<Sel | null>(null)
  const [undoStack, setUndoStack] = useState<Snap[]>([])
  const [redoStack, setRedoStack] = useState<Snap[]>([])
  const [playing, setPlaying] = useState(false)
  const [loopSel, setLoopSel] = useState(false)
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(0)
  const [status, setStatus] = useState('')
  const [exportFmt, setExportFmt] = useState<'wav16' | 'wav24' | 'flac'>('wav24')
  const [playhead, setPlayhead] = useState(0)
  const [ab, setAb] = useState<'stems' | 'original'>('stems')
  const [mixOpen, setMixOpen] = useState(false)
  const [dragTrackId, setDragTrackId] = useState<string | null>(null)
  const [intentOverride, setIntentOverride] = useState<string | null>(null)

  const wavesRef = useRef<Record<string, WaveformData>>({})
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const nullRef = useRef<HTMLAudioElement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    kind: 'sel' | 'playhead' | null
    trackId: string | null
    startX: number
  }>({ kind: null, trackId: null, startX: 0 })
  const stemsLoadedKey = useRef('')

  const selectedTrack = tracks.find((t) => t.id === selectedIds[0]) || null
  const anySolo = tracks.some((t) => t.solo)
  const timelineDur = useMemo(() => {
    let max = 0
    for (const t of tracks) {
      for (const c of t.clips) {
        const len = Math.max(0, (c.sourceEnd || t.duration) - c.sourceStart)
        max = Math.max(max, c.offset + len, t.duration)
      }
      max = Math.max(max, t.duration)
    }
    return max || file?.report.duration_seconds || 0
  }, [tracks, file])

  const viewDur = Math.max(0.001, (viewEnd || timelineDur) - viewStart)
  const activeIntent = intentOverride || MODE_INTENT[mode]
  const hasSel = !!sel && Math.abs(sel.end - sel.start) >= 0.01

  const pushUndo = useCallback(() => {
    setUndoStack((s) => [...s, { tracks: structuredClone(tracks), selectedIds: [...selectedIds] }])
    setRedoStack([])
  }, [tracks, selectedIds])

  const xToTime = useCallback(
    (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      return viewStart + frac * viewDur
    },
    [viewStart, viewDur],
  )

  const audible = useCallback(
    (t: Track) => {
      if (anySolo) return t.solo && !t.mute
      return !t.mute
    },
    [anySolo],
  )

  const applyVolumes = useCallback(() => {
    for (const t of tracks) {
      const el = audioRefs.current[t.id]
      if (!el) continue
      if (ab === 'original') {
        el.volume = t.id === tracks[0]?.id ? 1 : 0
      } else {
        el.volume = audible(t) ? Math.min(1.5, t.gain) : 0
      }
    }
  }, [tracks, audible, ab])

  useEffect(() => {
    applyVolumes()
  }, [applyVolumes])

  useEffect(() => {
    if (studioMixOpen) {
      setMixOpen(true)
      setStudioMixOpen(false)
    }
  }, [studioMixOpen, setStudioMixOpen])

  const loadWave = useCallback(async (track: Track) => {
    try {
      const width = Math.min(4000, Math.max(600, (canvasRefs.current[track.id]?.clientWidth || 900) * 2))
      const wave = await fetchWaveform(track.fileId, width)
      wavesRef.current[track.id] = wave
      setTracks((prev) =>
        prev.map((t) => {
          if (t.id !== track.id) return t
          const clips =
            t.clips.length === 1 && t.clips[0].sourceEnd === 0
              ? [{ ...t.clips[0], sourceEnd: wave.duration }]
              : t.clips
          return { ...t, duration: wave.duration, clips }
        }),
      )
      const canvas = canvasRefs.current[track.id]
      if (canvas) drawLane(canvas, wave, track.color)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const redrawAll = useCallback(() => {
    for (const t of tracks) {
      const wave = wavesRef.current[t.id]
      const canvas = canvasRefs.current[t.id]
      if (wave && canvas) drawLane(canvas, wave, t.color)
    }
  }, [tracks])

  useEffect(() => {
    redrawAll()
  }, [viewStart, viewEnd, redrawAll])

  // Seed from session file / studio target / separation stems
  useEffect(() => {
    if (studioTarget) {
      const t = trackFromFile(studioTarget.name, studioTarget.fileId, studioTarget.audioUrl)
      setTracks([t])
      setSelectedIds([t.id])
      setUndoStack([])
      setRedoStack([])
      setSel(null)
      setViewStart(0)
      setViewEnd(0)
      clearStudioTarget()
      void loadWave(t)
      return
    }
    const stems = (separateResult?.files || []).filter((f) => f.name !== 'residual' && f.file_id)
    const key = stems.map((s) => `${s.name}:${s.file_id}`).join('|')
    if (stems.length && key !== stemsLoadedKey.current) {
      stemsLoadedKey.current = key
      const next = stems.map((s) => trackFromFile(s.name, s.file_id!, s.url))
      if (file && separateResult?.source_url) {
        next.unshift(
          trackFromFile(`${file.name} (ref)`, file.fileId, separateResult.source_url || file.audioUrl),
        )
        next[0].mute = true
      }
      setTracks(next)
      setSelectedIds(next[0] ? [next[0].id] : [])
      setViewStart(0)
      setViewEnd(0)
      for (const t of next) void loadWave(t)
      return
    }
    if (!tracks.length && file) {
      const t = trackFromFile(file.name, file.fileId, file.audioUrl, file.report.duration_seconds)
      setTracks([t])
      setSelectedIds([t.id])
      setViewEnd(file.report.duration_seconds)
      void loadWave(t)
    }
  }, [studioTarget, separateResult, file, clearStudioTarget, loadWave, tracks.length])

  useEffect(() => {
    if (timelineDur > 0 && viewEnd <= 0) setViewEnd(timelineDur)
  }, [timelineDur, viewEnd])

  // Playhead RAF
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const first = selectedTrack
        ? audioRefs.current[selectedTrack.id]
        : tracks[0]
          ? audioRefs.current[tracks[0].id]
          : null
      const clock =
        nullRef.current && !nullRef.current.paused
          ? nullRef.current
          : Object.values(audioRefs.current).find((a) => a && !a.paused) || first
      if (clock && !clock.paused) {
        let t = clock.currentTime
        if (loopSel && hasSel && sel && t >= sel.end) {
          t = sel.start
          for (const el of Object.values(audioRefs.current)) {
            if (el) el.currentTime = t
          }
        }
        setPlayhead(t)
        setPlaying(true)
      } else {
        setPlaying(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tracks, selectedTrack, loopSel, hasSel, sel])

  const seekAll = useCallback((t: number) => {
    const clamped = Math.max(0, t)
    setPlayhead(clamped)
    for (const el of Object.values(audioRefs.current)) {
      if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(clamped, el.duration)
      else if (el) el.currentTime = clamped
    }
    if (nullRef.current) nullRef.current.currentTime = clamped
  }, [])

  const pauseAll = useCallback(() => {
    for (const el of Object.values(audioRefs.current)) el?.pause()
    nullRef.current?.pause()
    setPlaying(false)
  }, [])

  const playAll = useCallback(async () => {
    applyVolumes()
    const t = playhead
    const tasks: Promise<void>[] = []
    for (const tr of tracks) {
      const el = audioRefs.current[tr.id]
      if (!el) continue
      el.currentTime = Math.min(t, el.duration || t)
      if (ab === 'original') {
        if (tr.id === tracks[0]?.id) tasks.push(el.play().then(() => undefined).catch(() => undefined))
        else el.pause()
      } else if (audible(tr)) {
        tasks.push(el.play().then(() => undefined).catch(() => undefined))
      } else el.pause()
    }
    await Promise.all(tasks)
    setPlaying(true)
  }, [tracks, playhead, ab, audible, applyVolumes])

  const togglePlay = () => {
    if (playing) pauseAll()
    else {
      if (hasSel && sel && playhead < sel.start) seekAll(sel.start)
      void playAll()
    }
  }

  const stopToStart = () => {
    pauseAll()
    seekAll(hasSel && sel ? sel.start : 0)
  }

  const patchTrack = (id: string, patch: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const runEdit = async (op: EditOp, db?: number) => {
    const track = selectedTrack
    if (!track) {
      setStatus('Select a track first.')
      return
    }
    const needsSel = ['trim', 'delete', 'silence', 'fade_in', 'fade_out'].includes(op)
    if (needsSel && (!hasSel || !sel || sel.trackId !== track.id)) {
      setStatus('Select a region on the active track first.')
      return
    }
    const body: Parameters<typeof applyEdit>[0] = { file_id: track.fileId, op }
    if (needsSel && sel) {
      body.start = sel.start
      body.end = sel.end
    }
    if (op === 'gain') {
      body.db = db ?? 0
      if (hasSel && sel && sel.trackId === track.id) {
        body.start = sel.start
        body.end = sel.end
      }
    }
    try {
      pushUndo()
      const data = await applyEdit(body)
      const next: Track = {
        ...track,
        fileId: data.file_id,
        audioUrl: data.audio_url,
        duration: data.duration,
        clips: [{ id: uid('clip'), sourceStart: 0, sourceEnd: data.duration, offset: 0 }],
      }
      wavesRef.current[track.id] = data.waveform
      setTracks((prev) => prev.map((t) => (t.id === track.id ? next : t)))
      const canvas = canvasRefs.current[track.id]
      if (canvas) drawLane(canvas, data.waveform, track.color)
      setSel(null)
      setStatus(`Applied ${op}`)
      if (file && file.fileId === track.fileId) {
        setFile({ ...file, fileId: data.file_id, audioUrl: data.audio_url })
      }
      seekAll(0)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const splitAt = async (track: Track, at: number) => {
    if (at <= 0.02 || at >= track.duration - 0.02) {
      setStatus('Split point too close to an edge.')
      return
    }
    try {
      pushUndo()
      const data = await applyEdit({ file_id: track.fileId, op: 'split', at })
      if (!data.left || !data.right) throw new Error('Split returned incomplete result')
      const left = trackFromFile(`${track.name} L`, data.left.file_id, data.left.audio_url, data.left.duration)
      left.color = track.color
      left.gain = track.gain
      left.pan = track.pan
      const right = trackFromFile(
        `${track.name} R`,
        data.right.file_id,
        data.right.audio_url,
        data.right.duration,
      )
      right.color = track.color
      right.gain = track.gain
      right.pan = track.pan
      right.clips = right.clips.map((c) => ({ ...c, offset: at }))
      setTracks((prev) => {
        const i = prev.findIndex((t) => t.id === track.id)
        if (i < 0) return prev
        const next = [...prev]
        next.splice(i, 1, left, right)
        return next
      })
      setSelectedIds([left.id])
      void loadWave(left)
      void loadWave(right)
      setStatus(`Split at ${fmtTimecode(at)}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const bounceSelected = async () => {
    const chosen = tracks.filter((t) => selectedIds.includes(t.id) && t.name !== 'residual')
    const layers = (chosen.length ? chosen : tracks.filter((t) => !t.mute && audible(t))).filter(
      (t) => !t.name.endsWith('(ref)'),
    )
    if (layers.length < 1) {
      setStatus('Nothing to bounce.')
      return
    }
    try {
      pushUndo()
      const data = await bounceTracks(
        layers.map((t) => ({
          file_id: t.fileId,
          gain: t.gain,
          pan: t.pan,
          offset: t.clips[0]?.offset || 0,
        })),
      )
      const bounced = trackFromFile('Bounce', data.file_id, data.audio_url, data.duration)
      setTracks((prev) => [...prev, bounced])
      setSelectedIds([bounced.id])
      wavesRef.current[bounced.id] = data.waveform
      void loadWave(bounced)
      setStatus(`Bounced ${layers.length} track(s)`)
      setMixOpen(true)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const undo = () => {
    if (!undoStack.length) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, { tracks: structuredClone(tracks), selectedIds: [...selectedIds] }])
    setUndoStack((s) => s.slice(0, -1))
    setTracks(prev.tracks)
    setSelectedIds(prev.selectedIds)
    setStatus('Undid')
    for (const t of prev.tracks) void loadWave(t)
  }

  const redo = () => {
    if (!redoStack.length) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, { tracks: structuredClone(tracks), selectedIds: [...selectedIds] }])
    setRedoStack((s) => s.slice(0, -1))
    setTracks(next.tracks)
    setSelectedIds(next.selectedIds)
    setStatus('Redid')
    for (const t of next.tracks) void loadWave(t)
  }

  const duplicateTrack = (id: string) => {
    const t = tracks.find((x) => x.id === id)
    if (!t) return
    pushUndo()
    const copy: Track = {
      ...structuredClone(t),
      id: uid('trk'),
      name: `${t.name} copy`,
      clips: t.clips.map((c) => ({ ...c, id: uid('clip') })),
    }
    setTracks((prev) => {
      const i = prev.findIndex((x) => x.id === id)
      const next = [...prev]
      next.splice(i + 1, 0, copy)
      return next
    })
    setSelectedIds([copy.id])
    wavesRef.current[copy.id] = wavesRef.current[id]
  }

  const deleteTracks = (ids: string[]) => {
    if (!ids.length) return
    pushUndo()
    setTracks((prev) => prev.filter((t) => !ids.includes(t.id)))
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)))
    setSel(null)
  }

  const addEmptyTrack = () => {
    pushUndo()
    const t = trackFromFile('Empty', '', '', 0)
    setTracks((prev) => [...prev, t])
    setSelectedIds([t.id])
  }

  const importTrack = async (f: File) => {
    try {
      const up = await uploadFile(f)
      pushUndo()
      const t = trackFromFile(up.name, up.file_id, up.audio_url, up.report.duration_seconds)
      setTracks((prev) => [...prev, t])
      setSelectedIds([t.id])
      void loadWave(t)
      setStatus(`Imported ${up.name}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const reorderTrack = (fromId: string, toId: string) => {
    if (fromId === toId) return
    pushUndo()
    setTracks((prev) => {
      const from = prev.findIndex((t) => t.id === fromId)
      const to = prev.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const nudge = (delta: number) => {
    if (hasSel && sel) {
      setSel({
        trackId: sel.trackId,
        start: Math.max(0, sel.start + delta),
        end: Math.max(0.05, sel.end + delta),
      })
      return
    }
    const id = selectedIds[0]
    if (!id) return
    pushUndo()
    setTracks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              clips: t.clips.map((c) => ({ ...c, offset: Math.max(0, c.offset + delta) })),
            }
          : t,
      ),
    )
  }

  const toggleAB = () => {
    if (!separateResult?.source_url) return
    const next = ab === 'stems' ? 'original' : 'stems'
    const t = playhead
    const was = playing
    pauseAll()
    setAb(next)
    for (const tr of tracks) {
      const el = audioRefs.current[tr.id]
      if (!el) continue
      if (next === 'original' && tr.id === tracks[0]?.id) {
        el.dataset.prev = el.src
        el.src = separateResult.source_url
        el.load()
      } else if (next === 'stems' && el.dataset.prev) {
        el.src = el.dataset.prev
        el.load()
      }
    }
    window.setTimeout(() => {
      seekAll(t)
      if (was) void playAll()
    }, 60)
  }

  const playNull = async () => {
    const residual = separateResult?.files.find((f) => f.name === 'residual')
    if (!residual) return
    pauseAll()
    let el = nullRef.current
    if (!el) {
      el = new Audio(residual.url)
      nullRef.current = el
    }
    el.currentTime = playhead
    try {
      await el.play()
      setPlaying(true)
      el.onended = () => setPlaying(false)
    } catch {
      /* ignore */
    }
  }

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'Escape') setSel(null)
      else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) setMode('select')
      else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) setMode('scrub')
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) setMode('split')
      else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) setMixOpen((v) => !v)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel) {
        e.preventDefault()
        void runEdit(e.shiftKey ? 'delete' : 'silence')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === '[') nudge(-0.05)
      else if (e.key === ']') nudge(0.05)
      else if (e.key === '=' || e.key === '+') {
        const mid = hasSel && sel ? (sel.start + sel.end) / 2 : viewStart + viewDur / 2
        const half = viewDur / 4
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(timelineDur, mid + half))
      } else if (e.key === '-') {
        const mid = viewStart + viewDur / 2
        const half = Math.min(timelineDur / 2, viewDur)
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(timelineDur, mid + half))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSel, sel, timelineDur, viewStart, viewDur, tracks, selectedIds, playing, playhead])

  // Wheel zoom/pan
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      if (!timelineDur) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const mid = viewStart + viewDur / 2
        const factor = e.deltaY > 0 ? 1.25 : 0.8
        const half = Math.max(0.05, (viewDur * factor) / 2)
        setViewStart(Math.max(0, mid - half))
        setViewEnd(Math.min(timelineDur, mid + half))
      } else {
        const shift = (e.deltaY || e.deltaX) * 0.001 * viewDur
        const start = Math.max(0, Math.min(timelineDur - viewDur, viewStart + shift))
        setViewStart(start)
        setViewEnd(start + viewDur)
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [timelineDur, viewStart, viewDur])

  const onLanePointer = (track: Track, e: React.PointerEvent<HTMLDivElement>) => {
    const lane = e.currentTarget
    const t = xToTime(e.clientX, lane)
    setSelectedIds([track.id])

    if (mode === 'split') {
      void splitAt(track, t)
      return
    }

    if (mode === 'scrub' || e.altKey) {
      dragRef.current = { kind: 'playhead', trackId: track.id, startX: e.clientX }
      seekAll(t)
      pauseAll()
      lane.setPointerCapture(e.pointerId)
      return
    }

    // select
    dragRef.current = { kind: 'sel', trackId: track.id, startX: e.clientX }
    setSel({ trackId: track.id, start: t, end: t })
    seekAll(t)
    lane.setPointerCapture(e.pointerId)
  }

  const onLaneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d.kind) return
    const t = xToTime(e.clientX, e.currentTarget)
    if (d.kind === 'playhead') {
      seekAll(t)
      return
    }
    if (d.kind === 'sel' && d.trackId) {
      let a = xToTime(d.startX, e.currentTarget)
      let b = t
      if (a > b) [a, b] = [b, a]
      setSel({ trackId: d.trackId, start: a, end: b })
    }
  }

  const onLaneUp = () => {
    dragRef.current = { kind: null, trackId: null, startX: 0 }
  }

  const playheadPct = ((playhead - viewStart) / viewDur) * 100
  const showPlayhead = playheadPct >= 0 && playheadPct <= 100

  if (!tracks.length && !file) {
    return (
      <EmptyGate title="Studio">
        Import a file or run Separate to load tracks into the timeline.
      </EmptyGate>
    )
  }

  const residual = separateResult?.files.find((f) => f.name === 'residual')
  const exportTarget = selectedTrack?.fileId || tracks[0]?.fileId

  return (
    <div className="module-panel bleed studio-layout module-enter">
      <div className="studio-header">
        <h2>Studio</h2>
        <button
          type="button"
          className="studio-help"
          title="Studio shortcuts"
          onClick={() => setModule('about')}
        >
          ?
        </button>
      </div>

      <div className="studio-toolbar compact">
        <div className="studio-tool-group" role="group" aria-label="Modes">
          {(
            [
              ['select', 'Sel', 'Select region (V)'],
              ['scrub', 'Scrub', 'Scrub playhead (A)'],
              ['split', 'Split', 'Split clip (C)'],
            ] as const
          ).map(([id, label, title]) => (
            <button
              key={id}
              type="button"
              className={mode === id ? 'active' : ''}
              title={title}
              onMouseEnter={() => setIntentOverride(MODE_INTENT[id])}
              onMouseLeave={() => setIntentOverride(null)}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="studio-tool-group" role="group" aria-label="Edits">
          {EDIT_TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.title}
              onMouseEnter={() => setIntentOverride(t.intent)}
              onMouseLeave={() => setIntentOverride(null)}
              onClick={() => void runEdit(t.op, t.db)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="studio-tool-group" role="group" aria-label="History">
          <button type="button" disabled={!undoStack.length} title="Undo" onClick={undo}>
            Undo
          </button>
          <button type="button" disabled={!redoStack.length} title="Redo" onClick={redo}>
            Redo
          </button>
          <button
            type="button"
            title="Bounce / combine selected tracks"
            onMouseEnter={() => setIntentOverride('Combine selected tracks into one bounced clip.')}
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => void bounceSelected()}
          >
            Bounce
          </button>
          <button
            type="button"
            className={mixOpen ? 'active' : ''}
            title="Mix drawer (M)"
            onClick={() => setMixOpen((v) => !v)}
          >
            Mix
          </button>
        </div>
      </div>
      <p className="studio-intent" role="status">
        {activeIntent}
      </p>

      <div className="studio-body">
        <div className="studio-timeline" ref={wrapRef}>
          <div className="studio-track-tools">
            <button type="button" title="Add empty track" onClick={addEmptyTrack}>
              + Track
            </button>
            <button type="button" title="Import audio as track" onClick={() => importRef.current?.click()}>
              Import
            </button>
            <input
              ref={importRef}
              type="file"
              accept="audio/*,.wav,.flac,.mp3,.ogg,.m4a"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importTrack(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              title="Duplicate selected"
              disabled={!selectedIds.length}
              onClick={() => selectedIds[0] && duplicateTrack(selectedIds[0])}
            >
              Dup
            </button>
            <button
              type="button"
              title="Delete selected tracks"
              disabled={!selectedIds.length}
              onClick={() => deleteTracks(selectedIds)}
            >
              Del
            </button>
          </div>

          {tracks.map((t) => {
            const selOn =
              hasSel && sel && sel.trackId === t.id
                ? {
                    left: ((sel.start - viewStart) / viewDur) * 100,
                    width: ((sel.end - sel.start) / viewDur) * 100,
                  }
                : null
            return (
              <div
                key={t.id}
                className={`studio-track${selectedIds.includes(t.id) ? ' selected' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragTrackId) reorderTrack(dragTrackId, t.id)
                  setDragTrackId(null)
                }}
              >
                <div
                  className="studio-track-head"
                  draggable
                  onDragStart={() => setDragTrackId(t.id)}
                  onDragEnd={() => setDragTrackId(null)}
                  onClick={() => setSelectedIds([t.id])}
                >
                  <span className="swatch" style={{ background: t.color }} aria-hidden />
                  <span className="studio-track-name" title={t.name}>
                    {t.name}
                  </span>
                  <button
                    type="button"
                    className={t.mute ? 'active' : ''}
                    title="Mute"
                    onClick={(e) => {
                      e.stopPropagation()
                      patchTrack(t.id, { mute: !t.mute })
                    }}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    className={t.solo ? 'active' : ''}
                    title="Solo"
                    onClick={(e) => {
                      e.stopPropagation()
                      patchTrack(t.id, { solo: !t.solo })
                    }}
                  >
                    S
                  </button>
                </div>
                <div
                  className={`studio-lane mode-${mode}`}
                  onPointerDown={(e) => onLanePointer(t, e)}
                  onPointerMove={onLaneMove}
                  onPointerUp={onLaneUp}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[t.id] = el
                      if (el && wavesRef.current[t.id]) drawLane(el, wavesRef.current[t.id], t.color)
                    }}
                    height={56}
                    aria-label={`${t.name} waveform`}
                  />
                  {t.clips.map((c) => {
                    const len = Math.max(0.01, (c.sourceEnd || t.duration) - c.sourceStart)
                    const left = ((c.offset - viewStart) / viewDur) * 100
                    const width = (len / viewDur) * 100
                    return (
                      <div
                        key={c.id}
                        className="studio-clip"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(0.3, width)}%`,
                          borderColor: t.color,
                        }}
                      />
                    )
                  })}
                  {selOn && (
                    <div
                      className="studio-overlay studio-sel"
                      style={{ left: `${selOn.left}%`, width: `${Math.max(0.2, selOn.width)}%` }}
                    />
                  )}
                  {showPlayhead && (
                    <div
                      className="studio-overlay studio-playhead draggable"
                      style={{ left: `${playheadPct}%` }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        dragRef.current = { kind: 'playhead', trackId: t.id, startX: e.clientX }
                        pauseAll()
                        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                      }}
                      onPointerMove={(e) => {
                        if (dragRef.current.kind !== 'playhead') return
                        const lane = e.currentTarget.parentElement
                        if (!lane) return
                        seekAll(xToTime(e.clientX, lane))
                      }}
                      onPointerUp={onLaneUp}
                    />
                  )}
                  <audio
                    ref={(el) => {
                      audioRefs.current[t.id] = el
                    }}
                    src={t.audioUrl || undefined}
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration
                      if (Number.isFinite(d) && d > 0) {
                        patchTrack(t.id, {
                          duration: d,
                          clips:
                            t.clips.length === 1 && !t.clips[0].sourceEnd
                              ? [{ ...t.clips[0], sourceEnd: d }]
                              : t.clips,
                        })
                      }
                    }}
                  />
                </div>
                <div className="studio-track-faders">
                  <label title="Gain">
                    G
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.01}
                      value={t.gain}
                      onChange={(e) => patchTrack(t.id, { gain: Number(e.target.value) })}
                      aria-label={`${t.name} gain`}
                    />
                  </label>
                  <label title="Pan">
                    P
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={t.pan}
                      onChange={(e) => patchTrack(t.id, { pan: Number(e.target.value) })}
                      aria-label={`${t.name} pan`}
                    />
                  </label>
                </div>
              </div>
            )
          })}
        </div>

        {mixOpen && (
          <aside className="studio-mix-drawer" aria-label="Mix">
            <h3>Mix</h3>
            <p className="intent">
              Preview bus — mute/solo/gain/pan stay client-side until you Bounce or export.
            </p>
            <div className="mixer-tools">
              <button
                type="button"
                className={ab === 'original' ? 'active' : ''}
                disabled={!separateResult?.source_url}
                title="A/B original vs stems"
                onClick={toggleAB}
              >
                A/B: {ab === 'stems' ? 'stems' : 'original'}
              </button>
              {residual && (
                <button type="button" title="Play residual null test" onClick={() => void playNull()}>
                  Null test
                </button>
              )}
              <button type="button" title="Bounce selected to one track" onClick={() => void bounceSelected()}>
                Bounce
              </button>
            </div>
            {typeof separateResult?.null_test_db === 'number' && (
              <p className="muted">
                Residual peak {separateResult.null_test_db} dBFS (lower = more accounted for).
              </p>
            )}
            <div className="field">
              <label htmlFor="studio-export-fmt">Export</label>
              <select
                id="studio-export-fmt"
                value={exportFmt}
                onChange={(e) => setExportFmt(e.target.value as typeof exportFmt)}
              >
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            {exportTarget && (
              <a
                className="primary"
                href={exportUrl(exportTarget, exportFmt)}
                download
                style={{
                  display: 'inline-block',
                  padding: '7px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  marginTop: 8,
                }}
              >
                Download selected
              </a>
            )}
            <ul className="studio-mix-stems">
              {tracks.map((t) => (
                <li key={t.id}>
                  <span className="swatch" style={{ background: t.color }} />
                  {t.name}
                  {t.fileId && (
                    <a href={t.audioUrl} download>
                      dl
                    </a>
                  )}
                </li>
              ))}
              {residual && (
                <li>
                  <span className="swatch" style={{ background: stemColor('residual') }} />
                  residual
                  <a href={residual.url} download>
                    dl
                  </a>
                </li>
              )}
            </ul>
          </aside>
        )}
      </div>

      <div className="studio-transport">
        <button type="button" onClick={togglePlay} title="Play or pause (Space)">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={stopToStart} title="Stop">
          Stop
        </button>
        <button
          type="button"
          className={loopSel ? 'active' : ''}
          onClick={() => setLoopSel((v) => !v)}
          title="Loop selection"
        >
          Loop
        </button>
        <label className="studio-seek" title="Scrub playhead">
          <span className="sr-only">Playhead</span>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, timelineDur || 1)}
            step={0.01}
            value={Math.min(playhead, timelineDur || 0)}
            onChange={(e) => {
              const was = playing
              pauseAll()
              seekAll(Number(e.target.value))
              if (was) void playAll()
            }}
          />
        </label>
        <span className="studio-times">
          {fmtTimecode(playhead)}
          {hasSel && sel
            ? ` · sel ${fmtTimecode(sel.start)}–${fmtTimecode(sel.end)} (${(sel.end - sel.start).toFixed(2)}s)`
            : ' · no selection'}
          {` · ${fmtTimecode(timelineDur)}`}
        </span>
      </div>

      {status && <p className="status-line muted">{status}</p>}
    </div>
  )
}
