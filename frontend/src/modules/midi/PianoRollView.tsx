import { useEffect, useRef, useState } from 'react'
import type { MidiEvent, TranscribeResult } from '../../api/types'
import { stemColor } from '../../constants/options'
import { IconErase, IconPause, IconPencil, IconPlay, IconSelect, IconStop } from '../../icons'
import { useSession } from '../../state/session'
import { startPhaseLockedMetronome, type MetronomeHandle } from './metronome'
import { MidiAudition } from './soundfontPlayer'

function prefersReducedMotion(): boolean {
  try {
    const root = document.documentElement
    if (root.dataset.reducedMotion === 'true') return true
    if (root.dataset.motion === 'reduce') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export type RollOptions = {
  velocityHeight: boolean
  noteGlow: boolean
  showGrid: boolean
  bloom: boolean
  colorByTrack: boolean
  showKeyboard: boolean
}

export const DEFAULT_ROLL_OPTIONS: RollOptions = {
  velocityHeight: true,
  noteGlow: true,
  showGrid: true,
  bloom: false,
  colorByTrack: true,
  showKeyboard: true,
}

type FlatNote = MidiEvent & { track: string; index: number }

function flatten(result: TranscribeResult): FlatNote[] {
  return Object.entries(result.tracks).flatMap(([track, evs]) =>
    evs.map((e, index) => ({ ...e, track, index })),
  )
}

const BLACK = new Set([1, 3, 6, 8, 10])

export function PianoRollView({
  result,
  options,
  interactive = false,
  tool = 'select',
  selected,
  onSelect,
  onDraw,
  onErase,
  onMoveResize,
  soundfontEnabled,
  soundfontUrls,
  metronomeOn,
  playheadSec,
  onPlayhead,
  playing,
}: {
  result: TranscribeResult
  options: RollOptions
  interactive?: boolean
  tool?: 'select' | 'draw' | 'erase'
  selected?: { track: string; index: number } | null
  onSelect?: (sel: { track: string; index: number } | null) => void
  onDraw?: (note: { track: string; onset: number; offset: number; pitch: number; velocity: number }) => void
  onErase?: (sel: { track: string; index: number }) => void
  onMoveResize?: (sel: { track: string; index: number }, patch: Partial<MidiEvent>) => void
  soundfontEnabled?: boolean
  soundfontUrls?: string[]
  metronomeOn?: boolean
  playheadSec?: number
  onPlayhead?: (t: number) => void
  playing?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const keysRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { file } = useSession()
  const audioRef = useRef<HTMLAudioElement>(null)
  const auditionRef = useRef<MidiAudition | null>(null)
  const metroRef = useRef<MetronomeHandle | null>(null)
  const [localPlaying, setLocalPlaying] = useState(false)
  const isPlaying = playing ?? localPlaying
  const dragRef = useRef<{
    kind: 'move' | 'resize' | 'draw'
    track: string
    index: number
    startX: number
    startY: number
    orig: MidiEvent
    pitch0: number
    t0: number
  } | null>(null)

  const layoutRef = useRef({
    tMax: 1,
    pLo: 48,
    pHi: 84,
    keyW: 36,
    dpr: 1,
    W: 1,
    H: 1,
  })

  useEffect(() => {
    if (!soundfontEnabled) {
      auditionRef.current?.dispose()
      auditionRef.current = null
      return
    }
    const a = new MidiAudition()
    a.setSoundfontUrls(soundfontUrls || [])
    auditionRef.current = a
    void a.ensure(soundfontUrls)
    return () => {
      a.dispose()
      if (auditionRef.current === a) auditionRef.current = null
    }
  }, [soundfontEnabled, soundfontUrls?.join('|')])

  useEffect(() => {
    const canvas = canvasRef.current
    const keys = keysRef.current
    if (!canvas) return
    const events = flatten(result)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const keyW = options.showKeyboard ? 42 : 0
    const cssW = canvas.clientWidth || wrapRef.current?.clientWidth || 640
    const cssH = 320
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    if (keys) {
      keys.width = keyW * dpr
      keys.height = cssH * dpr
    }
    const W = canvas.width
    const H = canvas.height
    const tMax = Math.max(1, ...(events.map((e) => e.offset)), 0.5) + 0.25
    let pLo = events.length ? Math.min(...events.map((e) => e.pitch)) - 2 : 48
    let pHi = events.length ? Math.max(...events.map((e) => e.pitch)) + 3 : 84
    if (pHi - pLo < 24) {
      const mid = (pHi + pLo) / 2
      pLo = Math.floor(mid - 12)
      pHi = Math.ceil(mid + 12)
    }
    pLo = Math.max(21, pLo)
    pHi = Math.min(108, pHi)
    layoutRef.current = { tMax, pLo, pHi, keyW, dpr, W, H }

    const x = (t: number) => (t / tMax) * W
    const y = (p: number) => H - ((p - pLo) / (pHi - pLo)) * H
    const rowH = H / (pHi - pLo)

    const bg =
      getComputedStyle(document.documentElement).getPropertyValue('--bg0').trim() || '#0e1116'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    if (options.showGrid) {
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
        const bar = Math.abs(t / beat) % 4 < 1e-6
        ctx.strokeStyle = bar ? '#2a3340' : '#1a1f28'
        ctx.beginPath()
        ctx.moveTo(x(t), 0)
        ctx.lineTo(x(t), H)
        ctx.stroke()
      }
    }

    if (!events.length) {
      ctx.fillStyle = '#98a0ad'
      ctx.font = `${14 * dpr}px sans-serif`
      ctx.fillText('No notes — run Transcribe or draw in Edit.', 16 * dpr, 30 * dpr)
    }

    for (const e of events) {
      const isSel = selected?.track === e.track && selected?.index === e.index
      const vel = Math.max(1, Math.min(127, e.velocity || 100)) / 127
      const hMul = options.velocityHeight ? 0.35 + 0.65 * vel : 0.8
      const color = options.colorByTrack ? stemColor(e.track) : '#9bb8d4'
      ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, e.confidence)
      ctx.fillStyle = color
      const nh = Math.max(2, rowH * hMul)
      const nx = x(e.onset)
      const nw = Math.max(2, x(e.offset) - x(e.onset) - 1)
      const ny = y(e.pitch) - nh * 0.9
      if (options.noteGlow && !prefersReducedMotion()) {
        ctx.shadowColor = color
        ctx.shadowBlur = 6 * dpr
      }
      ctx.fillRect(nx, ny, nw, nh)
      ctx.shadowBlur = 0
      if (isSel) {
        ctx.strokeStyle = '#e8eef6'
        ctx.lineWidth = 2 * dpr
        ctx.strokeRect(nx, ny, nw, nh)
      }
    }
    ctx.globalAlpha = 1

    if (keys) {
      const kctx = keys.getContext('2d')
      if (kctx) {
        kctx.fillStyle = bg
        kctx.fillRect(0, 0, keys.width, keys.height)
        for (let p = pLo; p <= pHi; p++) {
          const black = BLACK.has(p % 12)
          const top = y(p + 1)
          const bot = y(p)
          kctx.fillStyle = black ? '#1a1d24' : '#d8dde6'
          kctx.fillRect(0, top, keys.width, bot - top)
          kctx.strokeStyle = '#0e1116'
          kctx.strokeRect(0, top, keys.width, bot - top)
          if (!black && p % 12 === 0) {
            kctx.fillStyle = '#5a6575'
            kctx.font = `${10 * dpr}px sans-serif`
            kctx.fillText(`C${Math.floor(p / 12) - 1}`, 4 * dpr, bot - 4 * dpr)
          }
        }
      }
    }

    const frame = ctx.getImageData(0, 0, W, H)
    let raf = 0
    const audio = audioRef.current
    const fx = fxRef.current
    const fxCtx = fx?.getContext('2d')
    const allowFx = options.bloom && !prefersReducedMotion()

    const cursor = () => {
      if (!document.body.contains(canvas)) return
      const t =
        playheadSec != null
          ? playheadSec
          : audio && !audio.paused
            ? audio.currentTime
            : null
      if (t != null) {
        ctx.putImageData(frame, 0, 0)
        ctx.strokeStyle = '#9bb8d4'
        ctx.lineWidth = 2
        const cx = x(t)
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
        } else if (fx && fxCtx) {
          fxCtx.clearRect(0, 0, fx.width || 0, fx.height || 0)
        }
      }
      raf = requestAnimationFrame(cursor)
    }
    raf = requestAnimationFrame(cursor)
    return () => cancelAnimationFrame(raf)
  }, [result, options, selected, playheadSec, file])

  useEffect(() => {
    if (!metronomeOn || !isPlaying) {
      metroRef.current?.stop()
      metroRef.current = null
      return
    }
    const audio = audioRef.current
    const bpm = result.tempo_bpm || file?.report?.estimated_bpm || 120
    const playhead = playheadSec ?? audio?.currentTime ?? 0
    const audition = auditionRef.current
    const ctx = audition?.context ?? new AudioContext()
    metroRef.current = startPhaseLockedMetronome({
      bpm,
      playheadSec: playhead,
      audioNow: ctx.currentTime,
      downbeatSec: 0,
      context: audition?.context ?? undefined,
    })
    return () => {
      metroRef.current?.stop()
      metroRef.current = null
    }
  }, [metronomeOn, isPlaying, result.tempo_bpm, file?.report?.estimated_bpm, playheadSec])

  const hitTest = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { tMax, pLo, pHi, dpr, W, H } = layoutRef.current
    const mx = ((clientX - rect.left) / rect.width) * (W / dpr) * dpr
    const my = ((clientY - rect.top) / rect.height) * (H / dpr) * dpr
    const t = (mx / W) * tMax
    const pitch = Math.round(pLo + (1 - my / H) * (pHi - pLo))
    const events = flatten(result)
    let best: FlatNote | null = null
    let bestDist = Infinity
    for (const e of events) {
      if (t < e.onset - 0.02 || t > e.offset + 0.02) continue
      if (Math.abs(e.pitch - pitch) > 0.6) continue
      const dist = Math.abs(e.pitch - pitch) + Math.abs(t - (e.onset + e.offset) / 2) * 0.1
      if (dist < bestDist) {
        best = e
        bestDist = dist
      }
    }
    return { t, pitch, note: best }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) {
      const hit = hitTest(e.clientX, e.clientY)
      if (hit) {
        // Live scrub: seek playhead + media without pausing if already playing.
        if (onPlayhead) onPlayhead(hit.t)
        const audio = audioRef.current
        if (audio && Number.isFinite(hit.t)) {
          try {
            audio.currentTime = Math.max(0, hit.t)
          } catch {
            /* ignore */
          }
        }
      }
      return
    }
    const hit = hitTest(e.clientX, e.clientY)
    if (!hit) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

    if (tool === 'erase' && hit.note) {
      onErase?.({ track: hit.note.track, index: hit.note.index })
      return
    }
    if (tool === 'draw' && !hit.note) {
      const track = Object.keys(result.tracks)[0] || 'melody'
      const onset = hit.t
      const offset = hit.t + 60 / (result.tempo_bpm || 120) / 2
      onDraw?.({ track, onset, offset, pitch: hit.pitch, velocity: 100 })
      auditionRef.current?.noteOn(hit.pitch, 100, 0.2)
      return
    }
    if (hit.note) {
      onSelect?.({ track: hit.note.track, index: hit.note.index })
      const nearEnd = hit.t > hit.note.offset - Math.max(0.05, (hit.note.offset - hit.note.onset) * 0.2)
      dragRef.current = {
        kind: nearEnd ? 'resize' : 'move',
        track: hit.note.track,
        index: hit.note.index,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...hit.note },
        pitch0: hit.note.pitch,
        t0: hit.t,
      }
      auditionRef.current?.noteOn(hit.note.pitch, hit.note.velocity || 100, 0.15)
    } else {
      onSelect?.(null)
      if (onPlayhead) onPlayhead(hit.t)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !interactive) return
    const hit = hitTest(e.clientX, e.clientY)
    if (!hit) return
    if (drag.kind === 'move') {
      const dt = hit.t - drag.t0
      const dur = drag.orig.offset - drag.orig.onset
      onMoveResize?.(
        { track: drag.track, index: drag.index },
        {
          onset: Math.max(0, drag.orig.onset + dt),
          offset: Math.max(0.02, drag.orig.onset + dt + dur),
          pitch: hit.pitch,
        },
      )
    } else if (drag.kind === 'resize') {
      onMoveResize?.(
        { track: drag.track, index: drag.index },
        { offset: Math.max(drag.orig.onset + 0.03, hit.t) },
      )
    }
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const play = async () => {
    const audio = audioRef.current
    if (soundfontEnabled) {
      const ok = await auditionRef.current?.ensure(soundfontUrls)
      await auditionRef.current?.resume()
      if (ok && auditionRef.current?.context) {
        const ctx = auditionRef.current.context
        const now = ctx.currentTime + 0.05
        const startT = playheadSec ?? audio?.currentTime ?? 0
        for (const e of flatten(result)) {
          if (e.offset < startT) continue
          const when = now + Math.max(0, e.onset - startT)
          const dur = Math.max(0.05, e.offset - Math.max(e.onset, startT))
          auditionRef.current.schedule(e.pitch, e.velocity || 100, when, dur)
        }
        setLocalPlaying(true)
        window.setTimeout(
          () => setLocalPlaying(false),
          Math.max(500, (layoutRef.current.tMax - startT) * 1000),
        )
      }
    }
    if (audio) void audio.play()
  }

  const pause = () => {
    audioRef.current?.pause()
    setLocalPlaying(false)
  }

  const stop = () => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    setLocalPlaying(false)
    onPlayhead?.(0)
  }

  return (
    <div className="midi-roll">
      <div className="piano-roll-wrap midi-roll-wrap" ref={wrapRef}>
        {options.showKeyboard && (
          <canvas ref={keysRef} className="piano-keys" aria-hidden="true" />
        )}
        <div className="piano-roll-main">
          <canvas
            ref={canvasRef}
            className="piano-roll"
            aria-label="Piano roll"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <canvas ref={fxRef} className="piano-roll-fx" aria-hidden="true" />
        </div>
      </div>
      <div className="row piano-transport" style={{ marginTop: '0.7rem' }}>
        <button
          type="button"
          className="primary studio-icon-btn"
          onClick={() => void play()}
          disabled={isPlaying}
          title="Play"
          aria-label="Play"
        >
          <IconPlay size={16} />
        </button>
        <button
          type="button"
          className="studio-icon-btn"
          onClick={pause}
          disabled={!isPlaying}
          title="Pause"
          aria-label="Pause"
        >
          <IconPause size={16} />
        </button>
        <button type="button" className="studio-icon-btn" onClick={stop} title="Stop" aria-label="Stop">
          <IconStop size={16} />
        </button>
        {interactive && (
          <span className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <IconSelect size={14} />
            <IconPencil size={14} />
            <IconErase size={14} />
          </span>
        )}
        {soundfontEnabled === false && (
          <span className="muted">Soundfont off — install GM SF2 in Prefs → Tools</span>
        )}
      </div>
      {file && (
        <audio
          ref={audioRef}
          src={file.audioUrl}
          preload="metadata"
          style={{ display: 'none' }}
          onPlay={() => setLocalPlaying(true)}
          onPause={() => setLocalPlaying(false)}
          onEnded={() => setLocalPlaying(false)}
          onTimeUpdate={() => {
            if (audioRef.current && onPlayhead) onPlayhead(audioRef.current.currentTime)
          }}
        />
      )}
    </div>
  )
}
