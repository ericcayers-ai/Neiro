/** DAW injector bridge — one shared Neiro window for every plugin instance. */

export interface DawInstance {
  instance_id: string
  track_name: string
  plugin_role: string
  host: string
  sample_rate: number
  channels: number
  learn_armed: boolean
  last_peak: number
  frames_captured: number
  idle_seconds?: number
}

export interface DawStatus {
  connected: boolean
  instance_count: number
  instances: DawInstance[]
  focus_instance: string | null
  focus_seq: number
  focus_module: string
  midi_seq: number
  capture_seq?: number
  last_capture?: {
    file_id: string
    name: string
    audio_url: string
    report: any
    module: string
    capture_seq: number
    instance_id?: string | null
  } | null
  allowed_modules?: string[]
  shared_window: boolean
  contract: string
}

export interface DawMidiEvent {
  pitch: number
  velocity: number
  note_on: boolean
  instance_id: string
  seq: number
}

export async function fetchDawStatus(): Promise<DawStatus> {
  const res = await fetch('/api/daw/status', { cache: 'no-store' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function pollDawMidi(afterSeq: number): Promise<{
  midi_seq: number
  events: DawMidiEvent[]
  focus_instance: string | null
}> {
  const res = await fetch(`/api/daw/midi?after_seq=${afterSeq}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
