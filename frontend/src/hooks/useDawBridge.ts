import { useEffect, useRef, useState } from 'react'
import { fetchDawStatus, pollDawMidi, type DawMidiEvent, type DawStatus } from '../api/daw'
import type { ModuleId } from '../api/types'
import { useSession } from '../state/session'

const MODULES: ModuleId[] = [
  'import',
  'analysis',
  'studio',
  'separate',
  'restore',
  'midi',
  'transcribe',
  'mixer',
  'learn',
  'preferences',
  'about',
]

function asModule(id: string | undefined | null, fallback: ModuleId): ModuleId {
  return MODULES.includes(id as ModuleId) ? (id as ModuleId) : fallback
}

/**
 * Polls the DAW injector bridge. When a plugin calls show-ui, focuses this
 * single Neiro window on the requested module. Captures load into the session
 * for Separate / Restore / Transcribe / etc. MIDI feeds Learn wait mode.
 */
export function useDawBridge(opts?: {
  onMidiNoteOn?: (pitch: number, velocity: number, instanceId: string) => void
}) {
  const { setModule, setFile } = useSession()
  const [status, setStatus] = useState<DawStatus | null>(null)
  const focusSeqRef = useRef(0)
  const midiSeqRef = useRef(0)
  const captureSeqRef = useRef(0)
  const onMidiRef = useRef(opts?.onMidiNoteOn)
  onMidiRef.current = opts?.onMidiNoteOn

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await fetchDawStatus()
        if (cancelled) return
        setStatus(next)
        if (next.focus_seq > focusSeqRef.current) {
          focusSeqRef.current = next.focus_seq
          setModule(asModule(next.focus_module, 'midi'))
          try {
            window.focus()
          } catch {
            /* ignore */
          }
        }
        if ((next.capture_seq || 0) > captureSeqRef.current && next.last_capture) {
          captureSeqRef.current = next.capture_seq || 0
          const cap = next.last_capture
          setFile({
            fileId: cap.file_id,
            name: cap.name,
            audioUrl: cap.audio_url,
            report: cap.report,
          })
          setModule(asModule(cap.module, 'separate'))
          try {
            window.focus()
          } catch {
            /* ignore */
          }
        }
      } catch {
        if (!cancelled) setStatus(null)
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 750)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [setModule, setFile])

  useEffect(() => {
    if (!status?.connected) return
    let cancelled = false
    const tick = async () => {
      try {
        const batch = await pollDawMidi(midiSeqRef.current)
        if (cancelled) return
        midiSeqRef.current = batch.midi_seq
        for (const ev of batch.events as DawMidiEvent[]) {
          if (ev.note_on) onMidiRef.current?.(ev.pitch, ev.velocity, ev.instance_id)
        }
      } catch {
        /* ignore transient */
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 200)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [status?.connected])

  return { status, dawConnected: Boolean(status?.connected) }
}
