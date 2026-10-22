import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PlayerEngine, type EngineMode } from './AudioEngine'
import { clampSeek, formatTime, Transport } from './Transport'
import {
  EQ_FREQS,
  EQ_PRESETS,
  FORMANT_RANGE,
  SPEED_RANGE,
  TRANSPOSE_RANGE,
  TUNING_PRESETS,
  describeMethod,
  normalizeParams,
  soundingA4,
  tuningToCents,
  type PlayerParams,
} from './params'
import {
  addMarker,
  buildRamp,
  makeClip,
  nextMarker,
  previousMarker,
  removeMarker,
  sequenceDuration,
  type Clip,
  type Marker,
  type RampMode,
  type RampScale,
} from './markers'
import { PlayerMidiPanel } from './PlayerMidiPanel'
import { PlayerShortcutPanel } from './PlayerShortcutPanel'
import { ShortcutMap, loadShortcutMap, type ShortcutAction } from './shortcuts'
import type { PitchReading } from './pitch'
import { addScene, applyScene, loadScenes, makeScene, persistScenes, removeScene, type SceneSnapshot } from './scenes'
import type { MidiAction } from './midi'
import type { AnalysisReport } from '../api/types'
import { getJob, startEditJob } from '../api/client'
import { AbxPanel } from './AbxPanel'
import { t } from './i18n'
import './player.css'

export interface PlayerNote {
  onset: number
  pitch: number
}

export interface PlayerSurfaceProps {
  src: string
  fileId: string
  title?: string
  duration?: number
  bpm?: number
  notes?: PlayerNote[]
  compact?: boolean
  /** Increment to resume a wait gate from an external controller (DAW MIDI). */
  resumeToken?: number
  /** Reports wait state and the pitch the player is waiting for. */
  onWaitChange?: (waiting: boolean, expectedPitch: number | null) => void
  /** Optional analysis report; renders chord/beat lanes under the transport. */
  analysis?: AnalysisReport | null
  /** Durable per-song settings (library) override local scratch values. */
  initialParams?: Partial<PlayerParams>
  /** Called on user parameter changes (the library debounces persistence). */
  onParamsChange?: (params: PlayerParams) => void
}

interface StoredState {
  params?: Partial<PlayerParams>
  markers?: Marker[]
  clips?: Clip[]
  seekStep?: number
  compact?: boolean
}

function loadStored(fileId: string): StoredState {
  try {
    const raw = localStorage.getItem(`neiro.player.${fileId}`)
    return raw ? (JSON.parse(raw) as StoredState) : {}
  } catch {
    return {}
  }
}

/** Deduplicate simultaneous notes (chords) into one wait point. */
function waitPointsFromNotes(notes: PlayerNote[] | undefined): number[] {
  if (!notes?.length) return []
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const points: number[] = []
  for (const note of sorted) {
    const last = points[points.length - 1]
    if (last == null || note.onset - last > 0.02) points.push(note.onset)
  }
  return points
}

export function PlayerSurface({
  src,
  fileId,
  title,
  duration,
  bpm,
  notes,
  compact,
  resumeToken,
  onWaitChange,
  analysis,
  initialParams,
  onParamsChange,
}: PlayerSurfaceProps) {
  const stored = useMemo(() => loadStored(fileId), [fileId])
  const [params, setParams] = useState<PlayerParams>(() =>
    normalizeParams({ ...(stored.params ?? {}), ...(initialParams ?? {}) }),
  )
  const [markers, setMarkers] = useState<Marker[]>(stored.markers ?? [])
  const [clips, setClips] = useState<Clip[]>(stored.clips ?? [])
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [latency, setLatency] = useState(0)
  const [mode, setMode] = useState<EngineMode>('preview')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [detected, setDetected] = useState<PitchReading | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderUrl, setRenderUrl] = useState<string | null>(null)
  const [renderNote, setRenderNote] = useState('')
  const [renderError, setRenderError] = useState('')
  const [abxOpen, setAbxOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [durationState, setDurationState] = useState(duration ?? 0)
  const [loopA, setLoopA] = useState<number | null>(null)
  const [loopB, setLoopB] = useState<number | null>(null)
  const [showEq, setShowEq] = useState(false)
  const [showRamp, setShowRamp] = useState(false)
  const [scenes, setScenes] = useState<SceneSnapshot[]>(() => loadScenes(fileId))
  const [seekStep, setSeekStep] = useState<number>(stored.seekStep ?? 5)
  const [compactMode, setCompactMode] = useState<boolean>(stored.compact ?? compact ?? false)
  const [ramp, setRamp] = useState({
    mode: 'scale' as RampMode,
    scale: 'major' as RampScale,
    from: 0,
    to: 12,
    repetitions: 1,
  })
  const engineRef = useRef<PlayerEngine | null>(null)
  const transportRef = useRef(new Transport())
  const waitIndexRef = useRef(0)
  const lastPositionRef = useRef(0)
  const clipRunRef = useRef<{ index: number; loops: number; sequence: boolean } | null>(null)
  const waitChangeRef = useRef(onWaitChange)
  waitChangeRef.current = onWaitChange
  const paramsChangeRef = useRef(onParamsChange)
  paramsChangeRef.current = onParamsChange
  const lastParamsRef = useRef('')
  const positionRef = useRef(0)
  positionRef.current = position

  const waitPoints = useMemo(() => waitPointsFromNotes(notes), [notes])
  const effectiveDuration = durationState || duration || 0
  const durationRef = useRef(0)
  durationRef.current = effectiveDuration
  const shortcutRef = useRef<ShortcutMap>(loadShortcutMap())
  const actionRef = useRef<(action: ShortcutAction) => void>(() => undefined)

  // Engine lifecycle: one context per surface, closed on unmount.
  useEffect(() => {
    const engine = new PlayerEngine()
    engineRef.current = engine
    let cancelled = false
    setReady(false)
    setError('')
    engine.onStatus = (status) => {
      if (cancelled) return
      setPosition(status.position)
      setPlaying(status.playing)
      setLatency(status.latencySeconds)
      const run = clipRunRef.current
      if (run) {
        const wrapped = status.position + 0.05 < lastPositionRef.current
        if (wrapped) {
          run.loops += 1
          const clip = clips[run.index]
          if (clip && run.loops >= Math.max(1, clip.loopCount)) {
            run.loops = 0
            run.index += 1
            if (run.index >= clips.length) {
              clipRunRef.current = null
              engine.pause()
              engine.setLoop({ enabled: false, start: 0, end: 0 })
            } else {
              engine.setLoop({ enabled: true, start: clips[run.index].start, end: clips[run.index].end })
              engine.seek(clips[run.index].start)
            }
          }
        }
      }
      lastPositionRef.current = status.position
    }
    engine.onWait = (waitPosition) => {
      if (cancelled) return
      setWaiting(true)
      setPosition(waitPosition)
      setPlaying(false)
      const expected = notes?.find((note) => note.onset >= waitPosition - 0.02)?.pitch ?? null
      waitChangeRef.current?.(true, expected)
    }
    engine.onEnded = () => {
      if (!cancelled) setPlaying(false)
    }
    engine.onError = (message) => {
      if (!cancelled) setError(message)
    }
    void engine
      .load(src)
      .then((value) => {
        if (cancelled) return
        setDurationState(value)
        transportRef.current.setDuration(value)
        setReady(true)
        setMode(engine.mode)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      engine.destroy()
      engineRef.current = null
    }
  }, [src])

  useEffect(() => {
    if (bpm && Math.abs(Math.round(bpm) - params.metronomeBpm) >= 1) update({ metronomeBpm: Math.round(bpm) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm])

  useEffect(() => {
    // Only notify on a real change (StrictMode runs effects twice on mount).
    const signature = JSON.stringify(params)
    if (signature === lastParamsRef.current) return
    lastParamsRef.current = signature
    paramsChangeRef.current?.(params)
  }, [params])

  useEffect(() => {
    if (!playing || mode !== 'preview') {
      setDetected(null)
      return
    }
    const timer = window.setInterval(() => {
      setDetected(engineRef.current?.pitchAt(positionRef.current) ?? null)
    }, 300)
    return () => window.clearInterval(timer)
  }, [playing, mode])

  useEffect(() => {
    // Low-latency mode intentionally drops the formant stage; the label says so.
    engineRef.current?.setParams({ ...params, formant: params.lowLatency ? 1 : params.formant })
    if (engineRef.current) setMode(engineRef.current.mode)
  }, [params])

  useEffect(() => {
    persistScenes(fileId, scenes)
  }, [fileId, scenes])

  useEffect(() => {
    const loopEnabled = params.loopEnabled && loopA != null && loopB != null && loopB > loopA
    engineRef.current?.setLoop({
      enabled: loopEnabled,
      start: loopA ?? 0,
      end: loopB ?? 0,
    })
  }, [params.loopEnabled, loopA, loopB])

  useEffect(() => {
    engineRef.current?.setWaitPoints(params.waitMode === 'off' ? [] : waitPoints)
    waitIndexRef.current = 0
  }, [params.waitMode, waitPoints, ready])

  // Persist per-file player state locally; the library is the durable store for
  // songs, this is the lightweight per-file scratchpad.
  useEffect(() => {
    const payload: StoredState = { params, markers, clips, seekStep, compact: compactMode }
    try {
      localStorage.setItem(`neiro.player.${fileId}`, JSON.stringify(payload))
    } catch {
      // storage full: keep playing rather than failing the surface
    }
  }, [fileId, params, markers, clips, seekStep, compactMode])

  const update = useCallback((patch: Partial<PlayerParams>) => {
    setParams((current) => normalizeParams({ ...current, ...patch }))
  }, [])

  const togglePlay = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (waiting) {
      setWaiting(false)
      engine.resume()
      setPlaying(true)
      return
    }
    if (playing) {
      engine.pause()
      setPlaying(false)
    } else {
      engine.play({
        from: position,
        countInBeats: params.countInBeats,
        bpm: bpm ?? 100,
      })
      setPlaying(true)
    }
  }, [bpm, params.countInBeats, playing, position, waiting])

  const resumeWait = useCallback(() => {
    const engine = engineRef.current
    if (!engine || !waiting) return
    setWaiting(false)
    engine.resume()
    setPlaying(true)
    waitChangeRef.current?.(false, null)
  }, [waiting])

  // External resume: the DAW/panel has already checked the pitch.
  useEffect(() => {
    if (!resumeToken || !waiting) return
    resumeWait()
    // resumeWait is intentionally excluded: a new token is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeToken])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      // Wait gating always wins and is deliberately not remappable.
      if (waiting && (event.code === 'Space' || event.key === 'Enter')) {
        event.preventDefault()
        resumeWait()
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        engineRef.current?.seek(0)
        setPosition(0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        const end = Math.max(0, durationRef.current - 0.05)
        engineRef.current?.seek(end)
        setPosition(end)
        return
      }
      const action = shortcutRef.current.match(event)
      if (!action) return
      event.preventDefault()
      if (action === 'seek-back' || action === 'seek-forward') {
        const delta = (action === 'seek-back' ? -1 : 1) * seekStep
        const target = clampSeek(positionRef.current, delta, durationRef.current)
        engineRef.current?.seek(target)
        setPosition(target)
        return
      }
      actionRef.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resumeWait, waiting, seekStep])

  // WebMIDI wait gate: only a matching pitch resumes; other notes are ignored.
  useEffect(() => {
    if (params.waitMode !== 'midi') return
    let access: MIDIAccess | null = null
    let cancelled = false
    const onMessage = (event: MIDIMessageEvent) => {
      const data = event.data
      if (!data || data.length < 3) return
      const status = data[0] & 0xf0
      const note = data[1]
      const velocity = data[2]
      if (status !== 0x90 || velocity === 0) return
      const expected = notes?.find((n) => n.onset >= position - 0.02)
      if (!expected || expected.pitch === note) resumeWait()
    }
    void (async () => {
      if (!navigator.requestMIDIAccess) return
      try {
        access = await navigator.requestMIDIAccess({ sysex: false })
        if (cancelled) return
        for (const input of access.inputs.values()) {
          input.addEventListener('midimessage', onMessage as EventListener)
        }
      } catch {
        setError('WebMIDI permission denied; use keyboard step mode.')
      }
    })()
    return () => {
      cancelled = true
      if (access) {
        for (const input of access.inputs.values()) {
          input.removeEventListener('midimessage', onMessage as EventListener)
        }
      }
    }
  }, [notes, params.waitMode, position, resumeWait])

  const method = describeMethod(params, params.bypass ? 'preview' : mode)
  // (assigned after onMidiAction below; declared early so the key effect can call it)
  const loopEnabled = params.loopEnabled && loopA != null && loopB != null && loopB > loopA

  const snapshotState = () => ({
    params,
    loop: { enabled: params.loopEnabled, start: loopA, end: loopB },
    markers,
    clips,
  })

  const saveSceneNow = () => {
    const name = window.prompt(t('player.scenePrompt'), `Scene ${scenes.length + 1}`)
    if (!name) return
    setScenes((current) => addScene(current, makeScene(name, snapshotState())))
    setMessage(t('player.sceneSaved'))
  }

  const useSceneNow = (scene: SceneSnapshot) => {
    const state = applyScene(scene)
    setParams(normalizeParams(state.params))
    setLoopA(state.loop.start)
    setLoopB(state.loop.end)
    setMarkers(state.markers)
    setClips(state.clips)
    setMessage(t('player.sceneApplied', { name: scene.name }))
  }

  const seekBy = (delta: number) => {
    const target = clampSeek(position, delta, effectiveDuration)
    engineRef.current?.seek(target)
    setPosition(target)
  }

  const onMidiAction = useCallback(
    (action: MidiAction) => {
      switch (action) {
        case 'play-pause':
          togglePlay()
          break
        case 'transpose-up':
          update({ transpose: Math.min(TRANSPOSE_RANGE.max, params.transpose + 1) })
          break
        case 'transpose-down':
          update({ transpose: Math.max(TRANSPOSE_RANGE.min, params.transpose - 1) })
          break
        case 'speed-up':
          update({ speed: Math.min(SPEED_RANGE.max, params.speed + 0.05) })
          break
        case 'speed-down':
          update({ speed: Math.max(SPEED_RANGE.min, params.speed - 0.05) })
          break
        case 'loop-toggle':
          if (loopA == null || loopB == null) {
            setLoopA(position)
            setLoopB(Math.min(position + 8, effectiveDuration || position + 8))
            update({ loopEnabled: true })
          } else {
            update({ loopEnabled: !params.loopEnabled })
          }
          break
        case 'marker-add':
          addMarkerAtPlayhead()
          break
        case 'reducer-toggle':
          update({ reducer: params.reducer > 0 ? 0 : 0.7 })
          break
        case 'eq-toggle':
          setShowEq((value) => !value)
          break
        case 'seek-back':
          seekBy(-5)
          break
        case 'seek-forward':
          seekBy(5)
          break
        default:
          break
      }
    },
    // The handler is recreated with the state it reads; the panel keeps it in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, loopA, loopB, position, playing, waiting, effectiveDuration],
  )
  actionRef.current = onMidiAction

  const renderWithNeiro = async () => {
    setRendering(true)
    setRenderError('')
    setRenderUrl(null)
    setRenderNote(t('player.rendering'))
    try {
      const rate = 1 / params.speed
      const semitones = params.transpose + params.pitchCents / 100
      const { job_id } = await startEditJob({
        file_id: fileId,
        op: 'render',
        rate,
        semitones,
      })
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
        const job = await getJob(job_id)
        if (job.status === 'done') {
          const result = job.result as
            | { audio_url?: string; provenance?: string | string[] | null }
            | undefined
          setRenderUrl(result?.audio_url ?? null)
          setRenderNote(
            t('player.renderReady', {
              method: String(result?.provenance ?? 'neiro-engine'),
            }),
          )
          return
        }
        if (job.status === 'error' || job.status === 'cancelled') {
          throw new Error(job.error || job.status)
        }
      }
      throw new Error('render timed out')
    } catch (error) {
      setRenderError(
        t('player.renderFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      setRenderNote('')
    } finally {
      setRendering(false)
    }
  }

  const addMarkerAtPlayhead = () => setMarkers((current) => addMarker(current, position))
  const jumpToMarker = (marker: Marker) => {
    engineRef.current?.seek(marker.time)
    setPosition(marker.time)
  }
  const loopMarker = (marker: Marker) => {
    const next = nextMarker(markers, marker.time)?.time ?? marker.time + 4
    setLoopA(marker.time)
    setLoopB(Math.min(next, effectiveDuration || next))
    update({ loopEnabled: true })
  }
  const createClip = () => {
    const start = loopA ?? position
    const end = loopB ?? Math.min(position + 4, effectiveDuration || position + 4)
    if (end <= start) return
    setClips((current) => [...current, makeClip(start, end)])
  }
  const playClip = (clip: Clip) => {
    const engine = engineRef.current
    if (!engine) return
    clipRunRef.current = { index: clips.findIndex((c) => c.id === clip.id), loops: 0, sequence: false }
    engine.setLoop({ enabled: true, start: clip.start, end: clip.end })
    engine.seek(clip.start)
    engine.play({ from: clip.start, countInBeats: clip.countInBeats, bpm: bpm ?? 100 })
    setPlaying(true)
  }
  const playSequence = () => {
    if (!clips.length) return
    const engine = engineRef.current
    if (!engine) return
    const first = clips.findIndex((c) => c.enabled)
    if (first < 0) return
    clipRunRef.current = { index: first, loops: 0, sequence: true }
    engine.setLoop({ enabled: true, start: clips[first].start, end: clips[first].end })
    engine.seek(clips[first].start)
    engine.play({ from: clips[first].start, countInBeats: clips[first].countInBeats, bpm: bpm ?? 100 })
    setPlaying(true)
  }
  const createRamp = () => {
    const generated = buildRamp({
      mode: ramp.mode,
      scale: ramp.scale,
      fromSemitone: ramp.from,
      toSemitone: ramp.to,
      start: loopA ?? position,
      end: loopB ?? Math.min(position + 2, effectiveDuration || position + 2),
      repetitions: ramp.repetitions,
    })
    setClips((current) => [...current, ...generated])
    setShowRamp(false)
  }

  return (
    <section
      className={`player-surface${compactMode || compact ? ' is-compact' : ''}`}
      aria-label="Neiro player"
    >
      <header className="player-head">
        <div>
          <h3>{title || t('player.play')}</h3>
          <p className="intent">
            {t('player.method')}: <strong>{method.label}</strong> — {method.detail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCompactMode((value) => !value)}
          aria-expanded={!compactMode}
          title={t('player.compactHint')}
        >
          {compactMode ? t('player.expand') : t('player.compact')}
        </button>
        <div className="player-meta" role="status" aria-live="polite">
          <span>{formatTime(position)} / {formatTime(effectiveDuration)}</span>
          <span title="Measured control + output latency">
            {t('player.latency')}: {Math.round(latency * 1000)} ms
          </span>
        </div>
      </header>

      {error && (
        <p className="player-error" role="alert">
          {t('player.failed', { error })}
        </p>
      )}
      {!ready && !error && <p className="intent">{t('player.loading')}</p>}

      <div className="player-transport">
        <button type="button" className="primary" onClick={togglePlay} disabled={!ready} aria-label={playing ? t('player.pause') : t('player.play')}>
          {playing ? t('player.pause') : t('player.play')}
        </button>
        <button
          type="button"
          onClick={() => {
            engineRef.current?.seek(0)
            setPosition(0)
          }}
          title="Back to start"
        >
          {t('player.start')}
        </button>
        <select
          value={seekStep}
          onChange={(event) => setSeekStep(Number(event.target.value))}
          aria-label={t('player.seekStep')}
          title={t('player.seekStep')}
        >
          <option value={5}>±5 s</option>
          <option value={10}>±10 s</option>
          <option value={30}>±30 s</option>
        </select>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, effectiveDuration)}
          step={0.01}
          value={Math.min(position, effectiveDuration || 0)}
          onChange={(event) => {
            const value = Number(event.target.value)
            engineRef.current?.seek(value)
            setPosition(value)
          }}
          aria-label={t('player.seek')}
          aria-valuetext={`${formatTime(position)} of ${formatTime(effectiveDuration)}`}
        />
        <button
          type="button"
          className={loopEnabled ? 'active' : ''}
          onClick={() => update({ loopEnabled: !params.loopEnabled })}
          title="Loop between A and B"
        >
          {t('player.loop')}
        </button>
        <button type="button" onClick={() => setLoopA(position)}>
          {t('player.setA')} {loopA != null ? formatTime(loopA) : '—'}
        </button>
        <button type="button" onClick={() => setLoopB(position)}>
          {t('player.setB')} {loopB != null ? formatTime(loopB) : '—'}
        </button>
        <button
          type="button"
          onClick={() => {
            setLoopA(null)
            setLoopB(null)
            update({ loopEnabled: false })
          }}
        >
          {t('player.clearLoop')}
        </button>
        <button
          type="button"
          onClick={() => {
            const marker = previousMarker(markers, position)
            if (marker) jumpToMarker(marker)
          }}
          disabled={!markers.length}
          title="Previous marker"
        >
          {t('player.prevMarker')}
        </button>
        <button
          type="button"
          onClick={() => {
            const marker = nextMarker(markers, position)
            if (marker) jumpToMarker(marker)
          }}
          disabled={!markers.length}
          title="Next marker"
        >
          {t('player.nextMarker')}
        </button>
      </div>

      <p className="player-readout" role="status" aria-live="polite">
        {t('player.readout', {
          hz: soundingA4(params).toFixed(2),
          mode: params.lowLatency ? 'low-latency (formant off)' : 'phase-vocoder preview',
        })}
        {detected && (
          <span className="player-detected">
            {' '}· {t('player.heard', {
              note: `${detected.note}${detected.octave}`,
              cents: `${detected.cents >= 0 ? '+' : ''}${detected.cents}`,
            })}
          </span>
        )}
      </p>

      {(analysis?.chords?.length || analysis?.beats?.length) && (
        <div className="player-analysis" aria-label="Chord and beat overlay">
          {analysis?.chords && analysis.chords.length > 0 && (
            <div className="player-analysis-chords" role="img" aria-label={analysis.chords.map((c) => c.chord).join(' ')}>
              {analysis.chords.map((chord, index) => {
                const total = Math.max(0.001, analysis.duration_seconds || effectiveDuration || 1)
                const left = (Math.max(0, chord.start) / total) * 100
                const width = Math.max(0.6, ((chord.end - chord.start) / total) * 100)
                return (
                  <span key={`${chord.chord}-${index}`} style={{ left: `${left}%`, width: `${width}%` }}>
                    {chord.chord}
                  </span>
                )
              })}
            </div>
          )}
          {analysis?.beats && analysis.beats.length > 0 && (
            <div className="player-analysis-beats" role="img" aria-label={`${analysis.beats.length} beats`}>
              {analysis.beats.map((beat, index) => (
                <i
                  key={`${beat.time}-${index}`}
                  className={beat.downbeat ? 'is-downbeat' : ''}
                  style={{
                    left: `${(beat.time / Math.max(0.001, analysis.duration_seconds || effectiveDuration || 1)) * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {waiting && (
        <p className="player-wait" role="status" aria-live="assertive">
          {t('player.waiting', {
            pitch: notes?.find((n) => n.onset >= position - 0.02)?.pitch ?? '—',
          })}
        </p>
      )}

      <div className="player-grid">
        <label className="field">
          {t('player.transpose')} ({params.transpose >= 0 ? '+' : ''}{params.transpose} st)
          <input
            type="range"
            min={TRANSPOSE_RANGE.min}
            max={TRANSPOSE_RANGE.max}
            step={1}
            value={params.transpose}
            onChange={(event) => update({ transpose: Number(event.target.value) })}
            aria-valuetext={`${params.transpose} semitones`}
          />
        </label>
        <label className="field">
          {t('player.pitchCents')} ({params.pitchCents >= 0 ? '+' : ''}{params.pitchCents}¢)
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={params.pitchCents}
            onChange={(event) => update({ pitchCents: Number(event.target.value) })}
            aria-valuetext={`${params.pitchCents} cents`}
          />
        </label>
        <label className="field">
          {t('player.speed')} ({Math.round(params.speed * 100)}%)
          <input
            type="range"
            min={SPEED_RANGE.min}
            max={SPEED_RANGE.max}
            step={0.01}
            value={params.speed}
            onChange={(event) => update({ speed: Number(event.target.value) })}
            aria-valuetext={`${Math.round(params.speed * 100)} percent`}
          />
        </label>
        <label className="field">
          {t('player.formant')} (×{params.formant.toFixed(2)})
          <input
            type="range"
            min={FORMANT_RANGE.min}
            max={FORMANT_RANGE.max}
            step={0.01}
            value={params.formant}
            onChange={(event) => update({ formant: Number(event.target.value) })}
            aria-valuetext={`formant ${params.formant.toFixed(2)}`}
          />
        </label>
        <label className="field">
          {t('player.reducer')} ({Math.round(params.reducer * 100)}%)
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={params.reducer}
            onChange={(event) => update({ reducer: Number(event.target.value) })}
            aria-valuetext={`vocal reducer ${Math.round(params.reducer * 100)} percent`}
          />
        </label>
        <label className="field">
          {t('player.tuning')}
          <select
            value={TUNING_PRESETS.find((preset) => Math.abs(tuningToCents(preset.hz) - params.pitchCents) < 0.6)?.id ?? 'custom'}
            onChange={(event) => {
              const preset = TUNING_PRESETS.find((item) => item.id === event.target.value)
              if (preset) update({ pitchCents: Math.round(tuningToCents(preset.hz)) })
            }}
          >
            <option value="custom">Custom</option>
            {TUNING_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="player-grid player-toggles">
        <label className="field-inline">
          <input
            type="checkbox"
            checked={params.varispeed}
            onChange={(event) => update({ varispeed: event.target.checked })}
          />
          {t('player.varispeed')}
        </label>
        <label className="field-inline">
          <input
            type="checkbox"
            checked={params.countInBeats > 0}
            onChange={(event) => update({ countInBeats: event.target.checked ? 4 : 0 })}
          />
          {t('player.countIn')} ({params.countInBeats} beats)
        </label>
        <label className="field-inline">
          <input
            type="checkbox"
            checked={params.metronome}
            onChange={(event) => update({ metronome: event.target.checked })}
          />
          Metronome ({Math.round(params.metronomeBpm)} BPM)
        </label>
        <label className="field-inline">
          {t('player.waitMode')}
          <select
            value={params.waitMode}
            onChange={(event) => update({ waitMode: event.target.value as PlayerParams['waitMode'] })}
          >
            <option value="off">{t('player.waitOff')}</option>
            <option value="key">{t('player.waitKey')}</option>
            <option value="midi">{t('player.waitMidi')}</option>
          </select>
        </label>
        <button type="button" onClick={() => setShowEq((value) => !value)} aria-expanded={showEq}>
          {t('player.eq')}
        </button>
        <label className="field-inline">
          <input
            type="checkbox"
            checked={params.lowLatency}
            onChange={(event) => update({ lowLatency: event.target.checked })}
          />
          {t('player.lowLatency')}
        </label>
        <button type="button" onClick={() => update({ bypass: !params.bypass })} className={params.bypass ? 'active' : ''}>
          Bypass DSP
        </button>
        <button
          type="button"
          onClick={() => void renderWithNeiro()}
          disabled={rendering || !ready}
          title={t('player.renderHint')}
        >
          {rendering ? t('player.rendering') : t('player.render')}
        </button>
      </div>

      {(renderNote || renderError || renderUrl) && (
        <p className="player-render" role="status" aria-live="polite">
          {renderError || renderNote}
          {renderUrl && (
            <>
              {' '}
              <a href={renderUrl} download>
                {t('player.download')}
              </a>{' '}
              <button type="button" onClick={() => setAbxOpen(true)}>
                {t('player.abx')}
              </button>
            </>
          )}
        </p>
      )}

      <PlayerMidiPanel onAction={onMidiAction} />

      <PlayerShortcutPanel />

      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}

      {showEq && (
        <div className="player-eq">
          <label className="field">
            {t('player.eqPreset')}
            <select
              value={EQ_PRESETS.find((preset) => preset.gains.every((gain, i) => gain === params.eq[i]))?.id ?? 'custom'}
              onChange={(event) => {
                const preset = EQ_PRESETS.find((item) => item.id === event.target.value)
                if (preset) update({ eq: [...preset.gains] })
              }}
            >
              <option value="custom">Custom</option>
              {EQ_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {EQ_FREQS.map((freq, i) => (
            <label className="field" key={freq}>
              {freq >= 1000 ? `${freq / 1000}k` : freq} Hz ({params.eq[i] > 0 ? '+' : ''}{params.eq[i].toFixed(0)} dB)
              <input
                type="range"
                min={-15}
                max={15}
                step={1}
                value={params.eq[i]}
                onChange={(event) => {
                  const next = [...params.eq]
                  next[i] = Number(event.target.value)
                  update({ eq: next })
                }}
                aria-valuetext={`${params.eq[i]} decibels`}
              />
            </label>
          ))}
        </div>
      )}

      {!compactMode && (
      <div className="player-practice">
        <div className="player-panel">
          <div className="player-panel-head">
            <h4>{t('player.markers')}</h4>
            <button type="button" onClick={addMarkerAtPlayhead}>
              {t('player.addMarker')}
            </button>
          </div>
          {markers.length === 0 ? (
            <p className="intent">No markers yet.</p>
          ) : (
            <ul className="player-list">
              {markers.map((marker) => (
                <li key={marker.id}>
                  <button type="button" className="link" onClick={() => jumpToMarker(marker)}>
                    {formatTime(marker.time)} · {marker.label}
                  </button>
                  <button type="button" onClick={() => loopMarker(marker)}>
                    Loop
                  </button>
                  <button type="button" onClick={() => setMarkers((current) => removeMarker(current, marker.id))}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="player-panel">
          <div className="player-panel-head">
            <h4>{t('player.clips')}</h4>
            <button
        type="button"
        onClick={createClip}
        disabled={loopA == null || loopB == null || loopB <= loopA}
        title={loopA != null && loopB != null && loopB <= loopA ? 'Set A before B to create a clip' : undefined}
      >
              {t('player.createClip')}
            </button>
          </div>
          {clips.length === 0 ? (
            <p className="intent">Set A and B, then create a clip.</p>
          ) : (
            <>
              <ul className="player-list">
                {clips.map((clip) => (
                  <li key={clip.id}>
                    <span>{clip.name}</span>
                    <label className="field-inline">
                      loops
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={clip.loopCount}
                        onChange={(event) => {
                          const loopCount = Math.max(1, Number(event.target.value) || 1)
                          setClips((current) =>
                            current.map((item) => (item.id === clip.id ? { ...item, loopCount } : item)),
                          )
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => playClip(clip)}>
                      {t('player.playClip')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setClips((current) => current.filter((item) => item.id !== clip.id))}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button type="button" onClick={playSequence} disabled={!clips.length}>
                  {t('player.playSequence')} ({Math.round(sequenceDuration(clips))}s)
                </button>
                <button type="button" onClick={() => setShowRamp((value) => !value)} aria-expanded={showRamp}>
                  Practice ramp
                </button>
              </div>
            </>
          )}
          {showRamp && (
            <div className="player-ramp">
              <label className="field-inline">
                Mode
                <select value={ramp.mode} onChange={(event) => setRamp({ ...ramp, mode: event.target.value as RampMode })}>
                  <option value="chromatic">Chromatic</option>
                  <option value="fifths">Circle of fifths</option>
                  <option value="scale">Scale</option>
                </select>
              </label>
              <label className="field-inline">
                Scale
                <select value={ramp.scale} onChange={(event) => setRamp({ ...ramp, scale: event.target.value as RampScale })}>
                  <option value="major">Major</option>
                  <option value="natural-minor">Natural minor</option>
                  <option value="harmonic-minor">Harmonic minor</option>
                  <option value="melodic-minor">Melodic minor</option>
                </select>
              </label>
              <label className="field-inline">
                From
                <input type="number" min={-24} max={24} value={ramp.from} onChange={(event) => setRamp({ ...ramp, from: Number(event.target.value) })} />
              </label>
              <label className="field-inline">
                To
                <input type="number" min={-24} max={36} value={ramp.to} onChange={(event) => setRamp({ ...ramp, to: Number(event.target.value) })} />
              </label>
              <label className="field-inline">
                Repetitions
                <input type="number" min={1} max={10} value={ramp.repetitions} onChange={(event) => setRamp({ ...ramp, repetitions: Number(event.target.value) })} />
              </label>
              <button type="button" onClick={createRamp}>
                Create ramp clips
              </button>
            </div>
          )}
        </div>

        <div className="player-panel">
          <div className="player-panel-head">
            <h4>{t('player.scenes')}</h4>
            <button type="button" onClick={saveSceneNow}>
              {t('player.saveScene')}
            </button>
          </div>
          {scenes.length === 0 ? (
            <p className="intent">{t('player.sceneEmpty')}</p>
          ) : (
            <ul className="player-list">
              {scenes.map((scene) => (
                <li key={scene.id}>
                  <button type="button" className="link" onClick={() => useSceneNow(scene)}>
                    {scene.name}
                  </button>
                  <span className="intent">{scene.kind}</span>
                  <button
                    type="button"
                    onClick={() => setScenes((current) => removeScene(current, scene.id))}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="intent">{t('player.sceneHint')}</p>
        </div>
      </div>
      )}

      {abxOpen && renderUrl && (
        <AbxPanel
          originalUrl={src}
          renderedUrl={renderUrl}
          duration={duration ?? 0}
          onClose={() => setAbxOpen(false)}
        />
      )}
    </section>
  )
}
