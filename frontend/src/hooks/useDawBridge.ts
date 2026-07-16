import { useEffect, useRef, useState } from 'react'
import { fetchDawStatus, pollDawMidi, type DawMidiEvent, type DawStatus } from '../api/daw'
import { useSession } from '../state/session'

/**
 * Polls the DAW injector bridge. When a plugin calls show-ui, focuses this
 * single Neiro window, switches to Advanced + Learn, and feeds MIDI into Learn.
 */
export function useDawBridge(opts?: {
  onMidiNoteOn?: (pitch: number, velocity: number, instanceId: string) => void
}) {
  const { setModule, setWorkspaceMode, setFile } = useSession()
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
          setWorkspaceMode('advanced')
          setModule((next.focus_module as any) || 'learn')
          try {
            window.focus()
          } catch {
            /* ignore */
          }
        }
        if ((next.capture_seq || 0) > captureSeqRef.current && next.last_capture) {
          captureSeqRef.current = next.capture_seq || 0
          // Load captured file into session and navigate to requested module
          const cap = next.last_capture
          setWorkspaceMode('advanced')
          setFile({
            fileId: cap.file_id,
            name: cap.name,
            audioUrl: cap.audio_url,
            // @ts-expect-error AnalysisReport shape compatible
            report: cap.report,
          })
          setModule((cap.module as any) || 'separate')
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
  }, [setModule, setWorkspaceMode])

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
