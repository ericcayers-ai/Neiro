import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyEdit,
  bounceTracks,
  exportUrl,
  fetchSpectrogram,
  fetchWaveform,
  pitchCorrectFile,
  pitchShiftFile,
  reanalyzeFile,
  timeStretchFile,
  uploadFile,
  type EditOp,
} from '../api/client'
import type { PitchCorrectResult, SpectrogramData, StemPack, WaveformData } from '../api/types'
import {
  EXPORT_FORMATS,
  STEM_COLORS,
  fmtTimecode,
  snapTime,
  stemColor,
  stemIcon,
  stemLabel,
  transposeSuggestion,
} from '../constants/options'
import {
  IconLoop,
  IconMute,
  IconPause,
  IconPitchCorrect,
  IconPlay,
  IconRedo,
  IconReset,
  IconScrub,
  IconSelect,
  IconSolo,
  IconSpectrogram,
  IconSplit,
  IconStop,
  IconUndo,
  IconZoomIn,
  IconZoomOut,
} from '../icons'
import { JobProgress } from '../components/JobProgress'
import { useSession } from '../state/session'
import {
  readStudioTracks,
  writeStudioTracks,
  STUDIO_TRACKS_EVENT,
  type StudioTrackSnap,
} from '../state/sessionGraph'
import { drawWebGLSpectrogram } from '../viz/webgl'
import {
  clipLength,
  fitDefaultViewEnd,
  timelineToMedia,
  timelineToMediaHold,
  trackTimelineEnd,
  type StudioClip,
} from './studioTimeline'
import './modules.css'

type ToolMode = 'select' | 'scrub' | 'split' | 'move'

type Clip = StudioClip

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
  packId?: string
  /** Immediate edit parent (pitch/trim/…). */
  parentFileId?: string
  /** Root file before any edits on this chain — Reset to original. */
  originalFileId?: string
  originalAudioUrl?: string
}

type TrackGraph = {
  gain: GainNode
  pan: StereoPannerNode
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

interface CtxMenu {
  x: number
  y: number
  trackId: string
  time: number
}

const CLIP_COLOR_SWATCHES = [...new Set(Object.values(STEM_COLORS))]

const MODE_INTENT: Record<ToolMode, string> = {
  select: 'Drag on a lane to select a region for trim, silence, delete, or fades.',
  scrub: 'Click or drag to move the playhead without creating a selection.',
  split: 'Click a clip to cut it into two at that time.',
  move: 'Drag a clip horizontally — offset drives playback. Undo includes moves.',
}

const TRANSPORT_INTENT =
  'Transport uses the timeline playhead. Clips honor offset and source range; Stop leaves the playhead.'

function ToolGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="studio-tool-group" role="group" aria-label={label}>
      <span className="studio-tool-group-label">{label}</span>
      {children}
    </div>
  )
}

function StudioHelpSheet({
  onClose,
  onAbout,
}: {
  onClose: () => void
  onAbout: () => void
}) {
  return (
    <div className="studio-help-sheet" role="dialog" aria-label="Studio shortcuts">
      <div className="studio-help-sheet-head">
        <strong>Studio shortcuts</strong>
        <button type="button" onClick={onClose} aria-label="Close shortcuts">
          Close
        </button>
      </div>
      <p className="muted studio-help-lead">
        Windows-first: <kbd>Ctrl</kbd> is primary (<kbd>⌘</kbd> also works on Mac). Ignored while typing in
        a field.
      </p>
      <ul className="studio-help-list">
        <li>
          <kbd>Space</kbd> play / pause
        </li>
        <li>
          <kbd>Stop</kbd> pauses and <em>leaves the playhead</em> (does not jump to 0 or selection start)
        </li>
        <li>
          Loop + selection wraps <em>sel end → sel start</em> only — not the whole track
        </li>
        <li>
          <kbd>V</kbd> Select · <kbd>A</kbd> Scrub · <kbd>C</kbd> Split · <kbd>B</kbd> Move clip
        </li>
        <li>
          Beat snap (toolbar) snaps clip moves and nudges to the session BPM grid
        </li>
        <li>
          <kbd>Del</kbd> silence · <kbd>Shift+Del</kbd> delete / splice
        </li>
        <li>
          <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo
        </li>
        <li>
          <kbd>[</kbd> / <kbd>]</kbd> nudge ±50 ms · <kbd>=</kbd> / <kbd>-</kbd> zoom
        </li>
        <li>
          Right-click a clip for split, mute/solo, rename, color, bounce, pitch correct, spectrogram
        </li>
        <li>
          <kbd>M</kbd> Mix drawer · <kbd>?</kbd> this sheet · <kbd>Esc</kbd> close / clear selection
        </li>
      </ul>
      <p className="muted">
        Scrub or click the timeline to play from anywhere. Clip offset and source range map timeline time
        to media time per track.
      </p>
      <button type="button" className="studio-help-about" onClick={onAbout}>
        Full shortcut list in About
      </button>
    </div>
  )
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
  packId?: string,
): Track {
  const display = name.includes('(ref)') ? name : stemLabel(name)
  return {
    id: uid('trk'),
    name: display,
    fileId,
    audioUrl,
    color: stemColor(name),
    mute: false,
    solo: false,
    gain: 1,
    pan: 0,
    duration,
    packId,
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
    stemPacks,
    setStemPacks,
    updateStemPack,
    studioPackIntent,
    clearStudioPackIntent,
    startEngineJob,
    jobForKind,
    cancelSessionJob,
  } = useSession()

  const pitchJob = jobForKind('pitch_correct')

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
  const [beatSnap, setBeatSnap] = useState(false)
  const [keyConflict, setKeyConflict] = useState<string | null>(null)
  const [pendingTranspose, setPendingTranspose] = useState<{
    packId: string
    semitones: number
    label: string
  } | null>(null)
  const [dragTrackId, setDragTrackId] = useState<string | null>(null)
  const [intentOverride, setIntentOverride] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showSpectrogram, setShowSpectrogram] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [renameTrackId, setRenameTrackId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [colorTrackId, setColorTrackId] = useState<string | null>(null)

  const wavesRef = useRef<Record<string, WaveformData>>({})
  const specsRef = useRef<Record<string, SpectrogramData>>({})
  const fittedViewKey = useRef('')
  /** Skip persist until initial hydrate so empty mount does not wipe Open restore. */
  const [studioHydrated, setStudioHydrated] = useState(false)
  const fileRef = useRef(file)
  fileRef.current = file

  const applyStudioSnap = useCallback((snap: StudioTrackSnap[]) => {
    setTracks(
      snap.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c })),
      })),
    )
    setSelectedIds(snap[0] ? [snap[0].id] : [])
    setUndoStack([])
    setRedoStack([])
    fittedViewKey.current = ''
    setViewStart(0)
    setViewEnd(0)
  }, [])

  // Restore Studio timeline from sessionStorage; re-apply when Open restores while mounted.
  useEffect(() => {
    const snap = readStudioTracks()
    if (snap?.length) applyStudioSnap(snap)
    setStudioHydrated(true)
    const onRestore = () => {
      const next = readStudioTracks()
      if (next?.length) applyStudioSnap(next)
    }
    window.addEventListener(STUDIO_TRACKS_EVENT, onRestore)
    return () => window.removeEventListener(STUDIO_TRACKS_EVENT, onRestore)
  }, [applyStudioSnap])

  // Persist timeline for Save/Open + pack trackId integrity.
  useEffect(() => {
    if (!studioHydrated) return
    const snap: StudioTrackSnap[] = tracks.map((t) => ({
      id: t.id,
      name: t.name,
      fileId: t.fileId,
      audioUrl: t.audioUrl,
      color: t.color,
      mute: t.mute,
      solo: t.solo,
      gain: t.gain,
      pan: t.pan,
      duration: t.duration,
      packId: t.packId,
      clips: t.clips.map((c) => ({
        id: c.id,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        offset: c.offset,
      })),
    }))
    writeStudioTracks(snap.length ? snap : null)
  }, [tracks, studioHydrated])
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const specCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const nullRef = useRef<HTMLAudioElement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const graphByElRef = useRef(new WeakMap<HTMLAudioElement, TrackGraph>())
  const graphByTrackRef = useRef<Record<string, TrackGraph>>({})
  /** Master transport clock — independent of any single track ending. */
  const transportRef = useRef({ playing: false, originTimeline: 0, originPerf: 0 })
  const playheadRef = useRef(0)
  const dragRef = useRef<{
    kind: 'sel' | 'playhead' | 'clip-move' | null
    trackId: string | null
    clipId: string | null
    startX: number
    originOffset: number
    pushedUndo: boolean
  }>({ kind: null, trackId: null, clipId: null, startX: 0, originOffset: 0, pushedUndo: false })

  const selectedTrack = tracks.find((t) => t.id === selectedIds[0]) || null
  const anySolo = tracks.some((t) => t.solo)
  const timelineDur = useMemo(() => {
    let max = 0
    for (const t of tracks) {
      max = Math.max(max, trackTimelineEnd(t))
    }
    return max || file?.report.duration_seconds || 0
  }, [tracks, file])

  const sessionBpm = useMemo(() => {
    const packOf = (packId?: string) =>
      packId ? stemPacks.find((p) => p.id === packId) : undefined
    const selectedPack = packOf(selectedTrack?.packId)
    if (selectedPack?.bpm && selectedPack.bpm > 0) return selectedPack.bpm
    // Transport window: prefer pack owning an audible clip under the playhead.
    const underPlayhead = tracks.find((t) => {
      if (!t.packId) return false
      return t.clips.some((c) => {
        const start = c.offset
        const end = c.offset + Math.max(0, c.sourceEnd - c.sourceStart)
        return playhead >= start && playhead < end
      })
    })
    const phPack = packOf(underPlayhead?.packId)
    if (phPack?.bpm && phPack.bpm > 0) return phPack.bpm
    const anyPack = stemPacks.find((p) => p.bpm && p.bpm > 0)
    const fileBpm = file?.report.estimated_bpm
    return (anyPack?.bpm && anyPack.bpm > 0 ? anyPack.bpm : null) ||
      (fileBpm && fileBpm > 0 ? fileBpm : null) ||
      120
  }, [stemPacks, file, selectedTrack, tracks, playhead])

  const sessionKey = useMemo(() => {
    const packOf = (packId?: string) =>
      packId ? stemPacks.find((p) => p.id === packId) : undefined
    const selectedPack = packOf(selectedTrack?.packId)
    if (selectedPack?.key) return selectedPack.key
    const underPlayhead = tracks.find((t) => {
      if (!t.packId) return false
      return t.clips.some((c) => {
        const start = c.offset
        const end = c.offset + Math.max(0, c.sourceEnd - c.sourceStart)
        return playhead >= start && playhead < end
      })
    })
    const phPack = packOf(underPlayhead?.packId)
    if (phPack?.key) return phPack.key
    return stemPacks[0]?.key || file?.report.estimated_key || null
  }, [stemPacks, file, selectedTrack, tracks, playhead])

  const liveBeatPhase = useMemo(() => {
    if (!playing || !sessionBpm) return 0
    const beat = 60 / sessionBpm
    return (playhead % beat) / beat
  }, [playing, sessionBpm, playhead])

  const viewDur = Math.max(0.001, (viewEnd || timelineDur) - viewStart)
  const activeIntent = intentOverride || MODE_INTENT[mode]
  const hasSel = !!sel && Math.abs(sel.end - sel.start) >= 0.01

  playheadRef.current = playhead

  const snapIf = useCallback(
    (t: number) => (beatSnap ? snapTime(t, sessionBpm, 'beat') : t),
    [beatSnap, sessionBpm],
  )

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

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }, [])

  const wireTrackAudio = useCallback(
    (trackId: string, el: HTMLAudioElement | null) => {
      if (!el) {
        delete graphByTrackRef.current[trackId]
        return
      }
      audioRefs.current[trackId] = el
      let graph = graphByElRef.current.get(el)
      if (!graph) {
        const ctx = ensureAudioCtx()
        try {
          const source = ctx.createMediaElementSource(el)
          const gain = ctx.createGain()
          const pan = ctx.createStereoPanner()
          source.connect(gain)
          gain.connect(pan)
          pan.connect(ctx.destination)
          graph = { gain, pan }
          graphByElRef.current.set(el, graph)
          el.volume = 1
        } catch {
          /* Element may already be wired if React remounted oddly */
          graph = graphByElRef.current.get(el)
        }
      }
      if (graph) graphByTrackRef.current[trackId] = graph
    },
    [ensureAudioCtx],
  )

  const applyVolumes = useCallback(() => {
    for (const t of tracks) {
      const el = audioRefs.current[t.id]
      const graph = graphByTrackRef.current[t.id]
      let level = 0
      if (ab === 'original') {
        level = t.id === tracks[0]?.id ? 1 : 0
      } else if (audible(t)) {
        level = Math.min(1.5, t.gain)
      }
      if (graph) {
        graph.gain.gain.value = level
        graph.pan.pan.value = Math.max(-1, Math.min(1, t.pan))
        if (el) el.volume = 1
      } else if (el) {
        el.volume = Math.min(1, level)
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

  const loadSpectrogram = useCallback(async (track: Track) => {
    if (!track.fileId) return
    try {
      // Full-file spectrogram (view window is timeline space; clip offsets differ per track).
      const spec = await fetchSpectrogram(track.fileId)
      specsRef.current[track.id] = spec
      const canvas = specCanvasRefs.current[track.id]
      if (canvas) {
        const ok = drawWebGLSpectrogram(canvas, spec)
        if (!ok) {
          // Canvas 2D fallback: false-color intensity grid
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          const dpr = window.devicePixelRatio || 1
          const cssW = canvas.clientWidth || 400
          const cssH = 72
          canvas.width = cssW * dpr
          canvas.height = cssH * dpr
          ctx.fillStyle = '#0e1116'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          const { rows, cols, data } = spec
          for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
              const v = data[r * cols + c] / 255
              const x = (c / cols) * canvas.width
              const y = (r / rows) * canvas.height
              ctx.fillStyle = `rgb(${Math.floor(40 + v * 200)},${Math.floor(60 + v * 120)},${Math.floor(80 + v * 40)})`
              ctx.fillRect(x, y, Math.ceil(canvas.width / cols) + 1, Math.ceil(canvas.height / rows) + 1)
            }
          }
        }
      }
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

  useEffect(() => {
    if (!showSpectrogram) return
    for (const t of tracks) {
      if (t.fileId) void loadSpectrogram(t)
    }
  }, [showSpectrogram, tracks, loadSpectrogram])

  const applyFitView = useCallback((duration: number, force = false) => {
    if (!(duration > 0)) return
    const key = `${duration.toFixed(2)}`
    if (!force && fittedViewKey.current === key) return
    fittedViewKey.current = key
    setViewStart(0)
    setViewEnd(fitDefaultViewEnd(duration))
  }, [])

  // Seed from session file / studio target / pack intents (after hydrate so Open restore wins).
  useEffect(() => {
    if (!studioHydrated) return
    if (studioTarget) {
      const t = trackFromFile(studioTarget.name, studioTarget.fileId, studioTarget.audioUrl)
      setTracks([t])
      setSelectedIds([t.id])
      setUndoStack([])
      setRedoStack([])
      setSel(null)
      fittedViewKey.current = ''
      setViewStart(0)
      setViewEnd(0)
      clearStudioTarget()
      void loadWave(t)
      return
    }
    if (!tracks.length && file) {
      const t = trackFromFile(file.name, file.fileId, file.audioUrl, file.report.duration_seconds)
      setTracks([t])
      setSelectedIds([t.id])
      applyFitView(file.report.duration_seconds, true)
      void loadWave(t)
    }
  }, [
    studioHydrated,
    studioTarget,
    file,
    clearStudioTarget,
    loadWave,
    tracks.length,
    applyFitView,
  ])

  // Consume Separate → Studio pack intents (replace or append mashup packs).
  // Do not depend on `file` — batch Separate updates the active file while the queue drains.
  useEffect(() => {
    if (!studioPackIntent) return
    const intent = studioPackIntent
    let cancelled = false

    const run = async () => {
      const packId = uid('pack')
      let rate = 1
      const srcBpm = intent.bpm
      const tgtBpm = intent.alignToBpm
      if (
        intent.mode === 'add' &&
        srcBpm &&
        tgtBpm &&
        srcBpm > 0 &&
        tgtBpm > 0 &&
        Math.abs(srcBpm - tgtBpm) / tgtBpm > 0.01
      ) {
        rate = srcBpm / tgtBpm
      }

      const built: Track[] = []
      for (const s of intent.stems) {
        if (cancelled) return
        let fileId = s.fileId
        let url = s.url
        let duration = 0
        if (Math.abs(rate - 1) > 0.01) {
          try {
            const stretched = await timeStretchFile(fileId, rate)
            fileId = stretched.file_id
            url = stretched.audio_url
            duration = stretched.duration
          } catch (err) {
            setStatus(
              `BPM align stretch failed (${err instanceof Error ? err.message : String(err)}); loading unstretched.`,
            )
          }
        }
        const tr = trackFromFile(s.name, fileId, url, duration, packId)
        built.push(tr)
      }

      if (intent.sourceUrl && intent.mode === 'replace') {
        const src = fileRef.current
        const refName = src ? `${src.name} (ref)` : 'Reference (ref)'
        const ref = trackFromFile(refName, intent.sourceFileId, intent.sourceUrl, 0, packId)
        ref.mute = true
        built.unshift(ref)
      }

      if (cancelled) return

      const pack: StemPack = {
        id: packId,
        name: intent.name,
        sourceFileId: intent.sourceFileId,
        bpm: rate !== 1 && tgtBpm ? tgtBpm : intent.bpm,
        key: intent.key,
        trackIds: built.map((t) => t.id),
      }

      if (intent.mode === 'replace') {
        setStemPacks([pack])
        setTracks(built)
        setSelectedIds(built[0] ? [built[0].id] : [])
        setUndoStack([])
        setRedoStack([])
        fittedViewKey.current = ''
        setViewStart(0)
        setViewEnd(0)
      } else {
        setStemPacks((prev) => [...prev, pack])
        setTracks((prev) => [...prev, ...built])
        setSelectedIds(built[0] ? [built[0].id] : [])
      }

      for (const t of built) void loadWave(t)
      setMixOpen(true)
      setStudioMixOpen(true)

      const alignKey = intent.alignToKey
      if (intent.mode === 'add' && intent.key && alignKey) {
        const sug = transposeSuggestion(intent.key, alignKey)
        if (sug && sug.semitones !== 0) {
          setKeyConflict(sug.label)
          setPendingTranspose({ packId, semitones: sug.semitones, label: sug.label })
        } else {
          setKeyConflict(null)
          setPendingTranspose(null)
        }
      } else {
        setKeyConflict(null)
        setPendingTranspose(null)
      }

      setStatus(
        intent.mode === 'replace'
          ? `Loaded ${built.length} stem(s) into Studio`
          : `Added mashup pack “${intent.name}”${rate !== 1 ? ` · stretched ×${rate.toFixed(3)}` : ''}`,
      )
      clearStudioPackIntent()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [studioPackIntent, clearStudioPackIntent, loadWave, setStemPacks, setStudioMixOpen])

  useEffect(() => {
    if (timelineDur > 0 && viewEnd <= 0) {
      applyFitView(timelineDur)
    }
  }, [timelineDur, viewEnd, applyFitView])

  const syncTrackToTimeline = useCallback(
    (tr: Track, timelineT: number, wantPlay: boolean) => {
      const el = audioRefs.current[tr.id]
      if (!el || !tr.audioUrl) return
      const { media, inClip } = timelineToMediaHold(tr, timelineT)
      const shouldHear =
        wantPlay &&
        inClip &&
        (ab === 'original' ? tr.id === tracks[0]?.id : audible(tr))
      if (!Number.isFinite(el.duration) || el.duration <= 0) {
        /* metadata not ready yet */
      } else {
        const clamped = Math.min(Math.max(0, media), Math.max(0, el.duration - 0.001))
        // Force seek after scrub / when holding a gap edge (lower hysteresis).
        const hyst = inClip ? 0.045 : 0.001
        if (Math.abs(el.currentTime - clamped) > hyst) {
          try {
            el.currentTime = clamped
          } catch {
            /* ignore seek errors while loading */
          }
        }
      }
      if (shouldHear) {
        if (el.paused) void el.play().catch(() => undefined)
      } else if (!el.paused) {
        el.pause()
      }
    },
    [ab, audible, tracks],
  )

  const syncAllToTimeline = useCallback(
    (timelineT: number, wantPlay: boolean) => {
      for (const tr of tracks) syncTrackToTimeline(tr, timelineT, wantPlay)
      if (nullRef.current && !nullRef.current.paused) {
        nullRef.current.currentTime = timelineT
      }
    },
    [tracks, syncTrackToTimeline],
  )

  const armTransport = useCallback((timelineT: number) => {
    transportRef.current = {
      playing: true,
      originTimeline: timelineT,
      originPerf: performance.now(),
    }
    playheadRef.current = timelineT
    setPlayhead(timelineT)
    setPlaying(true)
  }, [])

  const pauseAll = useCallback(() => {
    transportRef.current.playing = false
    for (const el of Object.values(audioRefs.current)) el?.pause()
    nullRef.current?.pause()
    setPlaying(false)
  }, [])

  const seekAll = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, timelineDur || t))
      playheadRef.current = clamped
      setPlayhead(clamped)
      if (transportRef.current.playing) {
        transportRef.current.originTimeline = clamped
        transportRef.current.originPerf = performance.now()
      }
      syncAllToTimeline(clamped, transportRef.current.playing)
    },
    [timelineDur, syncAllToTimeline],
  )

  const playAll = useCallback(async () => {
    applyVolumes()
    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    const t = playheadRef.current
    armTransport(t)
    syncAllToTimeline(t, true)
  }, [applyVolumes, ensureAudioCtx, armTransport, syncAllToTimeline])

  /** Stop: pause transport and leave the playhead where it is. */
  const stopTransport = useCallback(() => {
    pauseAll()
  }, [pauseAll])

  // Master-clock playhead — keeps running when a short track ends.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const tr = transportRef.current
      if (tr.playing) {
        let t = tr.originTimeline + (performance.now() - tr.originPerf) / 1000
        if (loopSel && hasSel && sel) {
          const span = Math.max(0.01, sel.end - sel.start)
          if (t >= sel.end) {
            t = sel.start + ((t - sel.start) % span)
            tr.originTimeline = t
            tr.originPerf = performance.now()
            syncAllToTimeline(t, true)
          } else {
            syncAllToTimeline(t, true)
          }
        } else {
          if (timelineDur > 0 && t >= timelineDur) {
            t = timelineDur
            pauseAll()
            playheadRef.current = t
            setPlayhead(t)
            raf = requestAnimationFrame(tick)
            return
          }
          syncAllToTimeline(t, true)
        }
        playheadRef.current = t
        setPlayhead(t)
        setPlaying(true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loopSel, hasSel, sel, timelineDur, syncAllToTimeline, pauseAll])

  const togglePlay = () => {
    if (playing) pauseAll()
    else {
      if (hasSel && sel && playhead < sel.start) seekAll(sel.start)
      void playAll()
    }
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
      const startM = timelineToMedia(track, sel.start)
      if (startM === null) {
        setStatus('Selection starts outside the clip on this track.')
        return
      }
      // Map end via the same clip window (inclusive of clip end).
      const clip = track.clips.find((c) => {
        const len = clipLength(c, track.duration)
        return sel.start >= c.offset && sel.start < c.offset + len
      })
      body.start = startM
      body.end = clip
        ? Math.min(
            clip.sourceEnd > 0 ? clip.sourceEnd : track.duration,
            clip.sourceStart + (sel.end - clip.offset),
          )
        : sel.end
    }
    if (op === 'gain') {
      body.db = db ?? 0
      if (hasSel && sel && sel.trackId === track.id) {
        const startM = timelineToMedia(track, sel.start)
        const clip = track.clips.find((c) => {
          const len = clipLength(c, track.duration)
          return sel.start >= c.offset && sel.start < c.offset + len
        })
        if (startM !== null && clip) {
          body.start = startM
          body.end = Math.min(
            clip.sourceEnd > 0 ? clip.sourceEnd : track.duration,
            clip.sourceStart + (sel.end - clip.offset),
          )
        }
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
    const mediaAt = timelineToMedia(track, at)
    if (mediaAt === null) {
      setStatus('Split point is outside the clip on this track.')
      return
    }
    if (mediaAt <= 0.02 || mediaAt >= track.duration - 0.02) {
      setStatus('Split point too close to an edge.')
      return
    }
    try {
      pushUndo()
      const data = await applyEdit({ file_id: track.fileId, op: 'split', at: mediaAt })
      if (!data.left || !data.right) throw new Error('Split returned incomplete result')
      const left = trackFromFile(`${track.name} L`, data.left.file_id, data.left.audio_url, data.left.duration)
      left.color = track.color
      left.gain = track.gain
      left.pan = track.pan
      const clip = track.clips[0]
      if (clip) {
        left.clips = [
          {
            id: uid('clip'),
            sourceStart: 0,
            sourceEnd: data.left.duration,
            offset: clip.offset,
          },
        ]
      }
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

  const bounceSelected = async (trackIds?: string[], label = 'Bounce') => {
    const ids = trackIds || selectedIds
    const chosen = tracks.filter((t) => ids.includes(t.id) && t.name !== 'residual')
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
      const bounced = trackFromFile(label, data.file_id, data.audio_url, data.duration)
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

  const bouncePack = async (packId: string) => {
    const pack = stemPacks.find((p) => p.id === packId)
    if (!pack) {
      setStatus('Pack not found.')
      return
    }
    await bounceSelected(pack.trackIds, `Bounce · ${pack.name}`)
  }

  const pitchCorrectTrack = async (track?: Track | null) => {
    const target = track || selectedTrack
    if (!target?.fileId) {
      setStatus('Select a track with audio to pitch-correct.')
      return
    }
    const keyHint =
      stemPacks.find((p) => p.id === target.packId)?.key ||
      stemPacks.find((p) => p.trackIds.includes(target.id))?.key ||
      file?.report.estimated_key ||
      undefined
    try {
      pushUndo()
      setStatus('Pitch correcting…')
      const done = await startEngineJob({
        kind: 'pitch_correct',
        label: `Pitch correct · ${target.name}`,
        module: 'studio',
        startFn: () => pitchCorrectFile(target.fileId, { key: keyHint || undefined, strength: 1 }),
      })
      if (!done || done.status !== 'done' || !done.result) {
        setStatus(done?.error || 'Pitch correct cancelled or failed.')
        return
      }
      const data = done.result as PitchCorrectResult
      if (!data?.file_id || !data.audio_url) {
        setStatus('Pitch correct returned an unexpected payload.')
        return
      }
      const corrected = trackFromFile(
        `${target.name} · pitch`,
        data.file_id,
        data.audio_url,
        data.duration,
        target.packId,
      )
      corrected.color = target.color
      corrected.gain = target.gain
      corrected.pan = target.pan
      corrected.parentFileId = data.parent || target.fileId
      corrected.originalFileId = target.originalFileId || target.parentFileId || target.fileId
      corrected.originalAudioUrl = target.originalAudioUrl || target.audioUrl
      corrected.clips = [
        {
          id: uid('clip'),
          sourceStart: 0,
          sourceEnd: data.duration,
          offset: target.clips[0]?.offset || 0,
        },
      ]
      setTracks((prev) => {
        const i = prev.findIndex((t) => t.id === target.id)
        if (i < 0) return [...prev, corrected]
        const next = [...prev]
        next.splice(i + 1, 0, corrected)
        return next
      })
      setSelectedIds([corrected.id])
      if (data.waveform) wavesRef.current[corrected.id] = data.waveform
      void loadWave(corrected)
      setStatus(`Pitch correct → new clip${keyHint ? ` (${keyHint})` : ' (chromatic)'}`)
      setMixOpen(true)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const resetTrackToOriginal = (track?: Track | null) => {
    const target = track || selectedTrack
    if (!target) {
      setStatus('Select a track first.')
      return
    }
    const origId = target.originalFileId || target.parentFileId
    const origUrl = target.originalAudioUrl
    if (!origId || !origUrl || origId === target.fileId) {
      setStatus('No original parent for this track (already at source).')
      return
    }
    pushUndo()
    patchTrack(target.id, {
      fileId: origId,
      audioUrl: origUrl,
      parentFileId: undefined,
      originalFileId: undefined,
      originalAudioUrl: undefined,
      name: target.name.replace(/ · pitch$/, ''),
    })
    setStatus('Reset to original audio.')
  }

  const openCtxMenu = (track: Track, e: React.MouseEvent, time?: number) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedIds([track.id])
    const lane = (e.currentTarget as HTMLElement).closest('.studio-lane') as HTMLElement | null
    const t = time ?? (lane ? xToTime(e.clientX, lane) : playhead)
    setCtxMenu({ x: e.clientX, y: e.clientY, trackId: track.id, time: t })
    setColorTrackId(null)
  }

  const closeCtxMenu = () => {
    setCtxMenu(null)
    setColorTrackId(null)
  }

  useEffect(() => {
    if (!ctxMenu) return
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (el.closest?.('.studio-ctx-menu')) return
      closeCtxMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCtxMenu()
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const commitRename = () => {
    if (!renameTrackId) return
    const name = renameValue.trim()
    if (name) {
      pushUndo()
      patchTrack(renameTrackId, { name })
    }
    setRenameTrackId(null)
    setRenameValue('')
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
        start: snapIf(Math.max(0, sel.start + delta)),
        end: snapIf(Math.max(0.05, sel.end + delta)),
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
              clips: t.clips.map((c) => ({
                ...c,
                offset: snapIf(Math.max(0, c.offset + delta)),
              })),
            }
          : t,
      ),
    )
  }

  const reestimatePackOrSelection = async () => {
    const pack = stemPacks.find((p) => selectedIds.some((id) => p.trackIds.includes(id))) || stemPacks[0]
    const track =
      tracks.find((t) => selectedIds.includes(t.id) && t.fileId) ||
      tracks.find((t) => t.packId === pack?.id && t.fileId && !t.name.includes('(ref)')) ||
      tracks.find((t) => t.fileId)
    if (!track?.fileId) {
      setStatus('Select a track with audio to re-estimate BPM/key.')
      return
    }
    try {
      const data = await reanalyzeFile(track.fileId)
      if (pack) {
        updateStemPack(pack.id, {
          bpm: data.estimated_bpm,
          key: data.estimated_key,
        })
      }
      setStatus(
        `Re-estimated · ${data.estimated_bpm ? `~${Math.round(data.estimated_bpm)} BPM` : 'BPM ?'}${
          data.estimated_key ? ` · ${data.estimated_key}` : ''
        }`,
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const applyPendingTranspose = async () => {
    if (!pendingTranspose) return
    const { packId, semitones } = pendingTranspose
    const packTracks = tracks.filter((t) => t.packId === packId && !t.name.includes('(ref)'))
    if (!packTracks.length) {
      setStatus('No pack tracks to transpose.')
      return
    }
    try {
      pushUndo()
      const nextTracks = [...tracks]
      for (const tr of packTracks) {
        if (!tr.fileId) continue
        const data = await pitchShiftFile(tr.fileId, semitones)
        const i = nextTracks.findIndex((t) => t.id === tr.id)
        if (i >= 0) {
          nextTracks[i] = {
            ...nextTracks[i],
            fileId: data.file_id,
            audioUrl: data.audio_url,
            duration: data.duration,
            clips: [{ id: uid('clip'), sourceStart: 0, sourceEnd: data.duration, offset: tr.clips[0]?.offset || 0 }],
          }
          wavesRef.current[tr.id] = data.waveform
        }
      }
      setTracks(nextTracks)
      const pack = stemPacks.find((p) => p.id === packId)
      if (pack?.key && stemPacks[0] && packId !== stemPacks[0].id) {
        updateStemPack(packId, { key: stemPacks[0].key })
      }
      setPendingTranspose(null)
      setKeyConflict(null)
      setStatus(`Applied transpose ${semitones > 0 ? '+' : ''}${semitones} st`)
      for (const t of nextTracks.filter((x) => x.packId === packId)) void loadWave(t)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
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

  const zoomBy = useCallback(
    (factor: number) => {
      if (!timelineDur) return
      const mid = hasSel && sel ? (sel.start + sel.end) / 2 : viewStart + viewDur / 2
      const half = Math.max(0.05, (viewDur * factor) / 2)
      setViewStart(Math.max(0, mid - half))
      setViewEnd(Math.min(timelineDur, mid + half))
    },
    [timelineDur, hasSel, sel, viewStart, viewDur],
  )

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else       if (e.key === 'Escape') {
        if (ctxMenu) closeCtxMenu()
        else if (helpOpen) setHelpOpen(false)
        else setSel(null)
      } else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) setMode('select')
      else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) setMode('scrub')
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) setMode('split')
      else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey) setMode('move')
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
      else if (e.key === '=' || e.key === '+') zoomBy(0.5)
      else if (e.key === '-') zoomBy(2)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSel, sel, timelineDur, viewStart, viewDur, tracks, selectedIds, playing, playhead, helpOpen, zoomBy, ctxMenu])

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
      dragRef.current = {
        kind: 'playhead',
        trackId: track.id,
        clipId: null,
        startX: e.clientX,
        originOffset: 0,
        pushedUndo: false,
      }
      // Live scrub: seek while keeping transport state (playing stays playing).
      seekAll(t)
      lane.setPointerCapture(e.pointerId)
      return
    }

    if (mode === 'move') {
      const clip = track.clips.find((c) => {
        const len = clipLength(c, track.duration)
        return t >= c.offset && t < c.offset + len
      })
      if (!clip) return
      dragRef.current = {
        kind: 'clip-move',
        trackId: track.id,
        clipId: clip.id,
        startX: e.clientX,
        originOffset: clip.offset,
        pushedUndo: false,
      }
      lane.setPointerCapture(e.pointerId)
      return
    }

    // select
    dragRef.current = {
      kind: 'sel',
      trackId: track.id,
      clipId: null,
      startX: e.clientX,
      originOffset: 0,
      pushedUndo: false,
    }
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
    if (d.kind === 'clip-move' && d.trackId && d.clipId) {
      if (!d.pushedUndo) {
        pushUndo()
        d.pushedUndo = true
      }
      const dx = e.clientX - d.startX
      const r = e.currentTarget.getBoundingClientRect()
      const deltaT = (dx / r.width) * viewDur
      const nextOff = snapIf(Math.max(0, d.originOffset + deltaT))
      setTracks((prev) =>
        prev.map((tr) =>
          tr.id === d.trackId
            ? {
                ...tr,
                clips: tr.clips.map((c) => (c.id === d.clipId ? { ...c, offset: nextOff } : c)),
              }
            : tr,
        ),
      )
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
    dragRef.current = {
      kind: null,
      trackId: null,
      clipId: null,
      startX: 0,
      originOffset: 0,
      pushedUndo: false,
    }
  }

  const onClipPointer = (track: Track, clip: Clip, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setSelectedIds([track.id])
    if (mode === 'split') {
      const lane = e.currentTarget.parentElement
      if (!lane) return
      void splitAt(track, xToTime(e.clientX, lane))
      return
    }
    if (mode === 'scrub') {
      const lane = e.currentTarget.parentElement
      if (!lane) return
      seekAll(xToTime(e.clientX, lane))
      return
    }
    // move or select: dragging the clip body moves it
    dragRef.current = {
      kind: 'clip-move',
      trackId: track.id,
      clipId: clip.id,
      startX: e.clientX,
      originOffset: clip.offset,
      pushedUndo: false,
    }
    ;(e.currentTarget.parentElement as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  }

  const playheadPct = ((playhead - viewStart) / viewDur) * 100
  const showPlayhead = playheadPct >= 0 && playheadPct <= 100

  if (!tracks.length && !file) {
    return (
      <div className="module-panel bleed studio-layout module-enter">
        <div className="studio-header">
          <h2>Studio</h2>
          <button
            type="button"
            className="studio-help"
            title="Studio shortcuts (?)"
            aria-label="Studio shortcuts"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </div>
        <p className="studio-intent" role="status">
          Arrange stems and clips on a shared timeline. Import audio, run Separate, or add another pack.
        </p>
        <div className="gate" role="status">
          <div className="gate-title">Studio is empty</div>
          <p className="gate-body">
            Load audio into the timeline to play, loop a selection, and mix with pan/gain.
          </p>
          <div className="studio-gate-actions">
            <button type="button" className="primary" onClick={() => setModule('import')}>
              Import
            </button>
            <button type="button" onClick={() => setModule('separate')}>
              Separate
            </button>
            <button
              type="button"
              title="Import another song or stems as a pack on this timeline"
              onClick={() => setModule('import')}
            >
              Add pack
            </button>
          </div>
        </div>
        {helpOpen && (
          <StudioHelpSheet onClose={() => setHelpOpen(false)} onAbout={() => setModule('about')} />
        )}
      </div>
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
          title="Studio shortcuts (?)"
          aria-label="Studio shortcuts"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((v) => !v)}
        >
          ?
        </button>
      </div>

      <div className="studio-toolbar compact">
        <ToolGroup label="Transport">
          <button
            type="button"
            className="studio-icon-btn"
            title="Play or pause (Space)"
            aria-label={playing ? 'Pause' : 'Play'}
            onMouseEnter={() => setIntentOverride(TRANSPORT_INTENT)}
            onMouseLeave={() => setIntentOverride(null)}
            onClick={togglePlay}
          >
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Stop — leave playhead"
            aria-label="Stop"
            onMouseEnter={() =>
              setIntentOverride('Stop pauses playback and leaves the playhead where it is.')
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={stopTransport}
          >
            <IconStop size={16} />
          </button>
          <button
            type="button"
            className={`studio-icon-btn${loopSel ? ' active' : ''}`}
            title="Loop selection"
            aria-label="Loop selection"
            aria-pressed={loopSel}
            onMouseEnter={() =>
              setIntentOverride(
                hasSel
                  ? 'Loop wraps the selection end → start only (not the whole track).'
                  : 'Select a region first, then enable Loop.',
              )
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => setLoopSel((v) => !v)}
          >
            <IconLoop size={16} />
          </button>
        </ToolGroup>

        <ToolGroup label="Tools">
          {(
            [
              ['select', 'Select region (V)', IconSelect],
              ['scrub', 'Scrub playhead (A)', IconScrub],
              ['split', 'Split clip (C)', IconSplit],
              ['move', 'Move clip (B)', IconScrub],
            ] as const
          ).map(([id, title, Ico]) => (
            <button
              key={id}
              type="button"
              className={`studio-icon-btn${mode === id ? ' active' : ''}`}
              title={title}
              aria-label={title}
              aria-pressed={mode === id}
              onMouseEnter={() => setIntentOverride(MODE_INTENT[id])}
              onMouseLeave={() => setIntentOverride(null)}
              onClick={() => setMode(id)}
            >
              <Ico size={16} />
            </button>
          ))}
          <button
            type="button"
            className={`studio-icon-btn${beatSnap ? ' active' : ''}`}
            title="Snap clip moves to beat grid"
            aria-label="Beat snap"
            aria-pressed={beatSnap}
            onMouseEnter={() =>
              setIntentOverride(`Snap offsets to beats at ~${Math.round(sessionBpm)} BPM.`)
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => setBeatSnap((v) => !v)}
          >
            Snap
          </button>
        </ToolGroup>

        <ToolGroup label="View">
          <button
            type="button"
            className="studio-icon-btn"
            title="Zoom in (=)"
            aria-label="Zoom in"
            onClick={() => zoomBy(0.5)}
          >
            <IconZoomIn size={16} />
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Zoom out (-)"
            aria-label="Zoom out"
            onClick={() => zoomBy(2)}
          >
            <IconZoomOut size={16} />
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Fit view — useful window for long files"
            aria-label="Fit view"
            onClick={() => applyFitView(timelineDur, true)}
          >
            Fit
          </button>
          <button
            type="button"
            className={`studio-icon-btn${showSpectrogram ? ' active' : ''}`}
            title="Toggle spectrogram lane"
            aria-label="Spectrogram lane"
            aria-pressed={showSpectrogram}
            onMouseEnter={() =>
              setIntentOverride('Show log-frequency spectrogram under each waveform lane.')
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => setShowSpectrogram((v) => !v)}
          >
            <IconSpectrogram size={16} />
          </button>
        </ToolGroup>

        <ToolGroup label="Clip">
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
          <button
            type="button"
            className="studio-icon-btn"
            disabled={!undoStack.length}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            onClick={undo}
          >
            <IconUndo size={16} />
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            disabled={!redoStack.length}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            onClick={redo}
          >
            <IconRedo size={16} />
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Bounce / combine selected tracks"
            aria-label="Bounce"
            onMouseEnter={() => setIntentOverride('Combine selected tracks into one bounced clip.')}
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => void bounceSelected()}
          >
            Bounce
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Pitch correct — new clip (YIN snap + Rubber Band)"
            aria-label="Pitch correct"
            disabled={pitchJob?.status === 'running'}
            onMouseEnter={() =>
              setIntentOverride(
                'Corrective pitch snap for mono vocals → new timeline clip (Rubber Band when installed).',
              )
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => void pitchCorrectTrack()}
          >
            <IconPitchCorrect size={16} />
          </button>
          <button
            type="button"
            className="studio-icon-btn"
            title="Reset to original (before edits on this chain)"
            aria-label="Reset to original"
            disabled={
              !selectedTrack ||
              !(selectedTrack.originalFileId || selectedTrack.parentFileId) ||
              (selectedTrack.originalFileId || selectedTrack.parentFileId) === selectedTrack.fileId
            }
            onMouseEnter={() =>
              setIntentOverride('Restore this track’s audio from the edit parent / original source.')
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => resetTrackToOriginal()}
          >
            <IconReset size={16} />
          </button>
        </ToolGroup>

        <ToolGroup label="Mix">
          <button
            type="button"
            className={`studio-icon-btn${mixOpen ? ' active' : ''}`}
            title="Mix drawer (M)"
            aria-label="Mix"
            aria-pressed={mixOpen}
            onMouseEnter={() =>
              setIntentOverride('Mix drawer — mute/solo/gain/pan and export. Pan applies in live preview.')
            }
            onMouseLeave={() => setIntentOverride(null)}
            onClick={() => setMixOpen((v) => !v)}
          >
            Mix
          </button>
        </ToolGroup>
      </div>
      <p className="studio-intent" role="status">
        {activeIntent}
      </p>
      {pitchJob && (
        <JobProgress
          status={pitchJob}
          onCancel={() => void cancelSessionJob(pitchJob.id)}
        />
      )}

      {helpOpen && (
        <StudioHelpSheet onClose={() => setHelpOpen(false)} onAbout={() => setModule('about')} />
      )}

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
                  {renameTrackId === t.id ? (
                    <input
                      className="studio-rename-input"
                      value={renameValue}
                      autoFocus
                      aria-label={`Rename ${t.name}`}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') {
                          setRenameTrackId(null)
                          setRenameValue('')
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="stem-badge studio-track-badge" title={t.name}>
                      <span className="stem-badge-icon" aria-hidden>
                        {stemIcon(t.name)}
                      </span>
                      {stemLabel(t.name)}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`studio-icon-btn${t.mute ? ' active' : ''}`}
                    title="Mute"
                    aria-label={`Mute ${t.name}`}
                    aria-pressed={t.mute}
                    onClick={(e) => {
                      e.stopPropagation()
                      patchTrack(t.id, { mute: !t.mute })
                    }}
                  >
                    <IconMute size={14} />
                  </button>
                  <button
                    type="button"
                    className={`studio-icon-btn${t.solo ? ' active' : ''}`}
                    title="Solo"
                    aria-label={`Solo ${t.name}`}
                    aria-pressed={t.solo}
                    onClick={(e) => {
                      e.stopPropagation()
                      patchTrack(t.id, { solo: !t.solo })
                    }}
                  >
                    <IconSolo size={14} />
                  </button>
                </div>
                <div
                  className={`studio-lane mode-${mode}${showSpectrogram ? ' has-spec' : ''}`}
                  onPointerDown={(e) => onLanePointer(t, e)}
                  onPointerMove={onLaneMove}
                  onPointerUp={onLaneUp}
                  onContextMenu={(e) => openCtxMenu(t, e)}
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[t.id] = el
                      if (el && wavesRef.current[t.id]) drawLane(el, wavesRef.current[t.id], t.color)
                    }}
                    height={56}
                    aria-label={`${t.name} waveform`}
                  />
                  {showSpectrogram && (
                    <canvas
                      className="studio-spec-canvas"
                      ref={(el) => {
                        specCanvasRefs.current[t.id] = el
                        if (el && specsRef.current[t.id]) {
                          drawWebGLSpectrogram(el, specsRef.current[t.id])
                        }
                      }}
                      height={72}
                      aria-label={`${t.name} spectrogram`}
                    />
                  )}
                  {t.clips.map((c) => {
                    const len = Math.max(0.01, clipLength(c, t.duration))
                    const left = ((c.offset - viewStart) / viewDur) * 100
                    const width = (len / viewDur) * 100
                    return (
                      <div
                        key={c.id}
                        className="studio-clip studio-clip-movable"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(0.3, width)}%`,
                          borderColor: t.color,
                          ['--clip-color' as string]: t.color,
                        }}
                        onPointerDown={(e) => onClipPointer(t, c, e)}
                        onPointerMove={onLaneMove}
                        onPointerUp={onLaneUp}
                        onContextMenu={(e) => openCtxMenu(t, e)}
                        title={`${t.name} · drag to move · right-click for actions`}
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
                        dragRef.current = {
                          kind: 'playhead',
                          trackId: t.id,
                          clipId: null,
                          startX: e.clientX,
                          originOffset: 0,
                          pushedUndo: false,
                        }
                        // Live playhead scrub — do not pause transport.
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
                      wireTrackAudio(t.id, el)
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
            {stemPacks.length > 0 && (
              <div className="studio-pack-list">
                <div className="option-detail-title">Mashup packs</div>
                <ul>
                  {stemPacks.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {' '}
                        · {p.bpm ? `~${Math.round(p.bpm)} BPM` : 'BPM ?'}
                        {p.key ? ` · ${p.key}` : ''}
                      </span>
                      <div className="studio-pack-actions">
                        <button
                          type="button"
                          title={`Bounce pack “${p.name}”`}
                          onClick={() => void bouncePack(p.id)}
                        >
                          Bounce pack
                        </button>
                        {tracks
                          .filter((t) => p.trackIds.includes(t.id) && t.fileId && !t.name.includes('(ref)'))
                          .slice(0, 1)
                          .map((t) => (
                            <a
                              key={t.id}
                              href={exportUrl(t.fileId, exportFmt)}
                              download
                              title="Export first stem of pack"
                            >
                              Export stem
                            </a>
                          ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  title="Re-estimate BPM/key for the selected pack or track"
                  onClick={() => void reestimatePackOrSelection()}
                >
                  Re-estimate BPM/key
                </button>
                <button
                  type="button"
                  title="Bounce all non-muted pack tracks currently selected, or all audible"
                  onClick={() => void bounceSelected()}
                >
                  Bounce selection
                </button>
              </div>
            )}
            {keyConflict && (
              <div className="studio-key-conflict" role="status">
                <p>{keyConflict}</p>
                {pendingTranspose && pendingTranspose.semitones !== 0 && (
                  <button type="button" className="primary" onClick={() => void applyPendingTranspose()}>
                    Apply transpose
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setKeyConflict(null)
                    setPendingTranspose(null)
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
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
                  <span className="stem-badge" style={{ borderColor: t.color }}>
                    {stemLabel(t.name)}
                  </span>
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
                  <span className="stem-badge">{stemLabel('residual')}</span>
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
        <button type="button" onClick={stopTransport} title="Stop — leave playhead">
          Stop
        </button>
        <button
          type="button"
          className={loopSel ? 'active' : ''}
          onClick={() => setLoopSel((v) => !v)}
          title="Loop selection (wraps sel end → start)"
        >
          Loop
        </button>
        <span
          className={`studio-live-bpm${playing ? ' is-playing' : ''}`}
          title="Pack/session BPM under selection or playhead (phase-locked beat)"
          style={{ ['--beat-phase' as string]: String(liveBeatPhase) }}
        >
          <span className="studio-live-bpm-dot" aria-hidden />
          ~{Math.round(sessionBpm)} BPM
          {sessionKey ? ` · ${sessionKey}` : ''}
        </span>
        <label className="studio-seek" title="Scrub playhead">
          <span className="sr-only">Playhead</span>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, timelineDur || 1)}
            step={0.01}
            value={Math.min(playhead, timelineDur || 0)}
            onChange={(e) => {
              // Live transport scrub — seek without pause→play stutter.
              seekAll(Number(e.target.value))
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

      {ctxMenu && (() => {
        const track = tracks.find((x) => x.id === ctxMenu.trackId)
        if (!track) return null
        return (
          <div
            className="studio-ctx-menu"
            role="menu"
            aria-label="Clip actions"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void splitAt(track, ctxMenu.time)
                closeCtxMenu()
              }}
            >
              Split here
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                patchTrack(track.id, { mute: !track.mute })
                closeCtxMenu()
              }}
            >
              {track.mute ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                patchTrack(track.id, { solo: !track.solo })
                closeCtxMenu()
              }}
            >
              {track.solo ? 'Unsolo' : 'Solo'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRenameTrackId(track.id)
                setRenameValue(track.name)
                closeCtxMenu()
              }}
            >
              Rename…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => setColorTrackId(track.id)}
            >
              Color…
            </button>
            {colorTrackId === track.id && (
              <div className="studio-ctx-colors" role="group" aria-label="Clip color">
                {CLIP_COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="studio-color-swatch"
                    style={{ background: c }}
                    aria-label={`Color ${c}`}
                    onClick={() => {
                      pushUndo()
                      patchTrack(track.id, { color: c })
                      closeCtxMenu()
                    }}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void bounceSelected([track.id], `Bounce · ${track.name}`)
                closeCtxMenu()
              }}
            >
              Bounce
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void pitchCorrectTrack(track)
                closeCtxMenu()
              }}
            >
              Pitch correct
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={
                !(track.originalFileId || track.parentFileId) ||
                (track.originalFileId || track.parentFileId) === track.fileId
              }
              onClick={() => {
                resetTrackToOriginal(track)
                closeCtxMenu()
              }}
            >
              Reset to original
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowSpectrogram(true)
                setSelectedIds([track.id])
                void loadSpectrogram(track)
                closeCtxMenu()
              }}
            >
              Show spectrogram
            </button>
          </div>
        )
      })()}
    </div>
  )
}
