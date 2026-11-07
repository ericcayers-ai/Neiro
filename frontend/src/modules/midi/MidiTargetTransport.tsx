import { useEffect, useRef, useState } from 'react'

import { useT } from '../../i18n'
import { Transport, formatTime } from '../../player/Transport'
import { targetEndSec, type LibraryTarget } from '../../practice/library'

/**
 * Transport for a MIDI practice target that has no audio (PianoVision adoption leg F, transport half).
 *
 * The practice roll follows a transport clock and nothing else. When a recording is open that clock is
 * `PlayerSurface`'s worklet. A library target imported from a `.mid` has no recording, so before this
 * component the panel said "open the audio to play along" and the roll had nothing to fall.
 *
 * This is the same clock *model* the player uses — `Transport` from `player/Transport.ts`, the repo's
 * one pure transport state machine (play/pause/seek/tick/ended) — driven by a wall clock instead of the
 * audio worklet. It is deliberately never mounted alongside `PlayerSurface`: the panel renders it only
 * when there is no audio source, so the app still has exactly one transport per surface.
 *
 * Honest scope: with no audio there is nothing to transpose, stretch or apply formants to, so this bar
 * offers play/pause/restart of practice time only and says so.
 */

/** Repeating frame source. Extracted so tests drive the tick by hand instead of with timers. */
export type FrameLoop = (frame: (nowMs: number) => void) => () => void

/** The default loop: `requestAnimationFrame` where it exists, an interval otherwise (SSR-safe). */
const rafLoop: FrameLoop = (frame) => {
  if (typeof requestAnimationFrame !== 'function') {
    const id = setInterval(() => frame(Date.now()), 16)
    return () => clearInterval(id)
  }
  let handle = 0
  const step = (nowMs: number) => {
    frame(nowMs)
    handle = requestAnimationFrame(step)
  }
  handle = requestAnimationFrame(step)
  return () => cancelAnimationFrame(handle)
}

/** Position readout refresh, in transport seconds. The roll is fed every frame; this is the number only. */
const READOUT_INTERVAL_SEC = 0.1

/** The practice summary's "practise this section" request, same shape the player takes. */
export interface TargetLoopRequest {
  start: number
  end: number
  token: number
}

export interface MidiTargetTransportProps {
  /** The parsed target (`TranscribeResult.tracks`), used only to find its end. */
  tracks: LibraryTarget
  /** The target's own tempo, shown in the label (the transport is in seconds, not beats). */
  bpm?: number
  /** Same seam as `PlayerSurface.onPosition`: the panel's single clock input. */
  onPosition?: (position: number) => void
  /** Same seam as `PlayerSurface.onPlayingChange`: drives run boundaries and pass recording. */
  onPlayingChange?: (playing: boolean) => void
  /** Same seam as `PlayerSurface.practiceLoop`: a section loop with a restart token. */
  practiceLoop?: TargetLoopRequest | null
  /** Test seam: replace the frame source. Defaults to rAF/interval. */
  frameLoop?: FrameLoop
}

export function MidiTargetTransport({
  tracks,
  bpm,
  onPosition,
  onPlayingChange,
  practiceLoop,
  frameLoop,
}: MidiTargetTransportProps) {
  const t = useT()
  const duration = targetEndSec(tracks)

  const transportRef = useRef<Transport | null>(null)
  if (!transportRef.current) transportRef.current = new Transport({ duration })
  const transport = transportRef.current

  const [playing, setPlaying] = useState(false)
  const [shown, setShown] = useState(0)

  const positionNotify = useRef(onPosition)
  positionNotify.current = onPosition
  const playingNotify = useRef(onPlayingChange)
  playingNotify.current = onPlayingChange
  const shownAtRef = useRef(0)

  // A different target is a different piece: its length changes and the transport parks at 0.
  useEffect(() => {
    transport.setDuration(duration)
    transport.seek(0)
    shownAtRef.current = 0
    setShown(0)
    positionNotify.current?.(0)
  }, [tracks, duration, transport])

  // Practice time advances only while playing. `Transport.tick` owns loop/wait/end semantics; the end
  // event stops the bar so the panel's own "a pass ended" logic runs exactly once.
  useEffect(() => {
    if (!playing) return
    let last: number | null = null
    const cancel = (frameLoop ?? rafLoop)((nowMs) => {
      if (last == null) {
        last = nowMs
        return
      }
      const dt = Math.max(0, (nowMs - last) / 1000)
      last = nowMs
      const event = transport.tick(dt)
      const snapshot = transport.snapshot
      positionNotify.current?.(snapshot.position)
      if (snapshot.position - shownAtRef.current >= READOUT_INTERVAL_SEC || event === 'ended') {
        shownAtRef.current = snapshot.position
        setShown(snapshot.position)
      }
      if (event === 'ended') {
        playingNotify.current?.(false)
        setPlaying(false)
      }
    })
    return cancel
  }, [playing, transport, frameLoop])

  // "Practise this section" from the summary: the player applies it as an A–B loop and restarts, and
  // so does this bar — same request shape, same semantics, no second meaning for the control.
  useEffect(() => {
    if (!practiceLoop) return
    transport.setLoop({ enabled: true, start: practiceLoop.start, end: practiceLoop.end })
    transport.seek(practiceLoop.start)
    shownAtRef.current = practiceLoop.start
    setShown(practiceLoop.start)
    positionNotify.current?.(practiceLoop.start)
    transport.play()
    setPlaying(true)
    playingNotify.current?.(true)
  }, [practiceLoop, transport])

  const toggle = () => {
    if (playing) {
      transport.pause()
      setPlaying(false)
      playingNotify.current?.(false)
      return
    }
    if (transport.ended) transport.seek(0)
    transport.play()
    setPlaying(true)
    playingNotify.current?.(true)
  }

  const restart = () => {
    // "From the top" means the whole target, not a section loop left over from the summary.
    transport.setLoop({ enabled: false })
    transport.seek(0)
    shownAtRef.current = 0
    setShown(0)
    positionNotify.current?.(0)
    transport.play()
    setPlaying(true)
    playingNotify.current?.(true)
  }

  return (
    <div className="row midi-target-transport" role="group" aria-label={t('practice.targetTransportAria')}>
      <button type="button" onClick={toggle} aria-pressed={playing}>
        {playing ? t('practice.targetPause') : t('practice.targetPlay')}
      </button>
      <button type="button" onClick={restart} disabled={!playing && shown === 0}>
        {t('practice.targetRestart')}
      </button>
      <span className="muted">
        {formatTime(shown)} / {formatTime(duration)} ·{' '}
        {t('practice.targetClockMethod', {
          bpm: Math.round(bpm && Number.isFinite(bpm) ? bpm : 100),
        })}
      </span>
    </div>
  )
}
