import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StemFile } from '../api/types'
import { stemColor, fmtTimecode } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

interface ChannelState {
  mute: boolean
  solo: boolean
  gain: number
  pan: number
}

export function MixerModule() {
  const { separateResult, openInStudio, setModule } = useSession()
  const [ab, setAb] = useState<'stems' | 'original'>('stems')
  const [channels, setChannels] = useState<Record<string, ChannelState>>({})
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const nullRef = useRef<HTMLAudioElement | null>(null)
  const masterClock = useRef(0)

  const stems = useMemo(
    () => (separateResult?.files || []).filter((f) => f.name !== 'residual'),
    [separateResult],
  )
  const residual = separateResult?.files.find((f) => f.name === 'residual')

  const stemKey = stems.map((s) => s.name).join('|')
  useEffect(() => {
    const names = stemKey ? stemKey.split('|') : []
    setChannels((prev) => {
      const next: Record<string, ChannelState> = {}
      for (const name of names) {
        next[name] = prev[name] || { mute: false, solo: false, gain: 1, pan: 0 }
      }
      return next
    })
  }, [stemKey])

  const anySolo = Object.values(channels).some((c) => c.solo)

  const audible = useCallback(
    (name: string) => {
      const c = channels[name]
      if (!c) return true
      if (anySolo) return c.solo && !c.mute
      return !c.mute
    },
    [channels, anySolo],
  )

  const applyVolumes = useCallback(() => {
    for (const s of stems) {
      const el = audioRefs.current[s.name]
      if (!el) continue
      if (ab === 'original') {
        // Original A/B: only first stem plays the source at full; others muted
        const first = stems[0]?.name
        el.volume = s.name === first ? 1 : 0
      } else {
        el.volume = audible(s.name) ? channels[s.name]?.gain ?? 1 : 0
      }
    }
  }, [stems, channels, audible, ab])

  useEffect(() => {
    applyVolumes()
  }, [applyVolumes])

  const syncSeek = useCallback((t: number) => {
    masterClock.current = t
    setPosition(t)
    for (const el of Object.values(audioRefs.current)) {
      if (el && Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = Math.min(t, el.duration)
      }
    }
    if (nullRef.current && Number.isFinite(nullRef.current.duration)) {
      nullRef.current.currentTime = Math.min(t, nullRef.current.duration)
    }
  }, [])

  const pauseAll = useCallback(() => {
    for (const el of Object.values(audioRefs.current)) {
      el?.pause()
    }
    nullRef.current?.pause()
    setPlaying(false)
  }, [])

  const playAll = useCallback(async () => {
    applyVolumes()
    const t = masterClock.current
    const tasks: Promise<void>[] = []
    for (const s of stems) {
      const el = audioRefs.current[s.name]
      if (!el) continue
      el.currentTime = Math.min(t, el.duration || t)
      if (ab === 'original') {
        if (s.name === stems[0]?.name) tasks.push(el.play().then(() => undefined).catch(() => undefined))
        else el.pause()
      } else if (audible(s.name)) {
        tasks.push(el.play().then(() => undefined).catch(() => undefined))
      } else {
        el.pause()
      }
    }
    await Promise.all(tasks)
    setPlaying(true)
  }, [stems, ab, audible, applyVolumes])

  const togglePlay = () => {
    if (playing) pauseAll()
    else void playAll()
  }

  const setCh = (name: string, patch: Partial<ChannelState>) => {
    setChannels((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }

  const toggleAB = () => {
    const next = ab === 'stems' ? 'original' : 'stems'
    const t = masterClock.current
    const wasPlaying = playing
    pauseAll()
    setAb(next)
    for (const s of stems) {
      const el = audioRefs.current[s.name]
      if (!el || !separateResult?.source_url) continue
      if (next === 'original') {
        el.dataset.prev = el.src
        el.src = separateResult.source_url
      } else if (el.dataset.prev) {
        el.src = el.dataset.prev
      }
      el.load()
    }
    // Retain transport position across A/B
    window.setTimeout(() => {
      syncSeek(t)
      if (wasPlaying) void playAll()
    }, 50)
  }

  const playNull = async () => {
    if (!residual) return
    const wasPlaying = playing
    pauseAll()
    let el = nullRef.current
    if (!el) {
      el = new Audio(residual.url)
      nullRef.current = el
    }
    el.currentTime = masterClock.current
    try {
      await el.play()
      setPlaying(true)
      el.onended = () => setPlaying(false)
    } catch {
      if (wasPlaying) void playAll()
    }
  }

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const first = stems[0] ? audioRefs.current[stems[0].name] : null
      const src = ab === 'original' ? first : first
      const clock = nullRef.current && !nullRef.current.paused ? nullRef.current : src
      if (clock && !clock.paused) {
        masterClock.current = clock.currentTime
        setPosition(clock.currentTime)
        if (clock.duration && Number.isFinite(clock.duration)) setDuration(clock.duration)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stems, ab])

  if (!separateResult) {
    return (
      <div className="module-panel">
        <h2>Mixer</h2>
        <div className="gate">
          <p className="muted">No separation result yet.</p>
          <button type="button" onClick={() => setModule('separate')}>
            Go to Separate
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="module-panel">
      <h2>Mixer — {separateResult.model}</h2>
      <p className="lede">
        Synchronized stem preview with shared transport. Mute/solo/gain/pan are client-side only;
        downloads stay full level.
      </p>

      <div className="mixer-tools">
        <button type="button" className="primary" onClick={togglePlay} title="Play or pause all stems">
          {playing ? 'Pause' : 'Play all'}
        </button>
        <button
          type="button"
          onClick={() => {
            pauseAll()
            syncSeek(0)
          }}
          title="Stop and return to start"
        >
          Stop
        </button>
        <label className="field" style={{ margin: 0, minWidth: 160 }}>
          <span className="sr-only">Seek</span>
          <input
            type="range"
            min={0}
            max={Math.max(0.01, duration || 1)}
            step={0.01}
            value={Math.min(position, duration || 0)}
            onChange={(e) => {
              const t = Number(e.target.value)
              const was = playing
              pauseAll()
              syncSeek(t)
              if (was) void playAll()
            }}
            aria-label="Transport position"
          />
        </label>
        <span className="mono muted">
          {fmtTimecode(position)} / {fmtTimecode(duration)}
        </span>
        <button
          type="button"
          className={ab === 'original' ? 'active' : ''}
          onClick={toggleAB}
          title="Toggle original mix vs stem players"
          disabled={!separateResult.source_url}
        >
          A/B: {ab === 'stems' ? 'stems' : 'original'}
        </button>
        <span className="intent" style={{ margin: 0 }}>
          Instant compare — original file vs current stem set at the same playhead.
        </span>
        {residual && (
          <>
            <button type="button" onClick={() => void playNull()} title="Audition residual = mix − Σ stems">
              Null test
            </button>
            <span className="intent" style={{ margin: 0 }}>
              Play the residual (what separation left out). Lower peak dB means more of the mix
              accounted for.
            </span>
          </>
        )}
      </div>

      {stems.map((s: StemFile & { file_id?: string }) => (
        <div className="mixer-strip" key={s.name} data-stem={s.name}>
          <div className="mixer-name">
            <span className="swatch" style={{ background: stemColor(s.name) }} aria-hidden />
            <span>{s.name}</span>
          </div>
          <div>
            <audio
              ref={(el) => {
                audioRefs.current[s.name] = el
              }}
              src={s.url}
              preload="auto"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                if (Number.isFinite(d) && d > duration) setDuration(d)
              }}
            />
            <div className="mixer-controls" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={channels[s.name]?.mute ? 'active' : ''}
                onClick={() => setCh(s.name, { mute: !channels[s.name]?.mute })}
                title="Mute this stem in the preview players"
              >
                Mute
              </button>
              <button
                type="button"
                className={channels[s.name]?.solo ? 'active' : ''}
                onClick={() => setCh(s.name, { solo: !channels[s.name]?.solo })}
                title="Solo — hear only soloed stems"
              >
                Solo
              </button>
              <label>
                Gain
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={channels[s.name]?.gain ?? 1}
                  onChange={(e) => setCh(s.name, { gain: Number(e.target.value) })}
                  aria-label={`${s.name} gain`}
                />
              </label>
              <label>
                Pan
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={channels[s.name]?.pan ?? 0}
                  onChange={(e) => setCh(s.name, { pan: Number(e.target.value) })}
                  aria-label={`${s.name} pan`}
                />
              </label>
              <span className="intent" style={{ margin: 0 }}>
                Preview gain/pan only — does not rewrite the stem file.
              </span>
            </div>
          </div>
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <a href={s.url} download>
              download
            </a>
            {s.file_id && (
              <button
                type="button"
                onClick={() => openInStudio(s.file_id!, s.url, s.name)}
                title="Load this stem into Studio"
              >
                Open in Studio
              </button>
            )}
          </div>
        </div>
      ))}

      {residual && (
        <div className="mixer-strip">
          <div className="mixer-name">
            <span className="swatch" style={{ background: stemColor('residual') }} />
            residual
          </div>
          <audio
            ref={(el) => {
              nullRef.current = el
            }}
            src={residual.url}
            preload="auto"
          />
          <a href={residual.url} download>
            download
          </a>
        </div>
      )}

      <div className="meta-block">
        {typeof separateResult.null_test_db === 'number' && (
          <>
            Null test: residual peak {separateResult.null_test_db} dBFS (lower = more of the mix
            accounted for).
            <br />
          </>
        )}
        {(separateResult.notes || []).join(' · ')}
      </div>
    </div>
  )
}
