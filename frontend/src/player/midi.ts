/**
 * MIDI learn and mapping.
 *
 * One small service shared by the player: parse note/CC messages, learn a binding
 * for a named transport action, persist it locally, and resolve incoming messages
 * to actions. Device selection is "any connected input" (Transpose parity) with the
 * connected count shown in the UI.
 */

export type MidiAction =
  | 'play-pause'
  | 'transpose-up'
  | 'transpose-down'
  | 'speed-up'
  | 'speed-down'
  | 'loop-toggle'
  | 'marker-add'
  | 'reducer-toggle'
  | 'eq-toggle'
  | 'seek-back'
  | 'seek-forward'

export const MIDI_ACTIONS: { action: MidiAction; label: string }[] = [
  { action: 'play-pause', label: 'Play / pause' },
  { action: 'transpose-up', label: 'Transpose up' },
  { action: 'transpose-down', label: 'Transpose down' },
  { action: 'speed-up', label: 'Speed up' },
  { action: 'speed-down', label: 'Speed down' },
  { action: 'loop-toggle', label: 'A–B loop on/off' },
  { action: 'marker-add', label: 'Add marker' },
  { action: 'reducer-toggle', label: 'Vocal reducer on/off' },
  { action: 'eq-toggle', label: 'Equalizer panel' },
  { action: 'seek-back', label: 'Seek back 5 s' },
  { action: 'seek-forward', label: 'Seek forward 5 s' },
]

export interface MidiMessage {
  type: 'note' | 'cc'
  channel: number
  number: number
  value: number
}

export interface MidiMapping {
  action: MidiAction
  type: 'note' | 'cc'
  number: number
  channel: number | null
}

export function parseMidiMessage(data: ArrayLike<number>): MidiMessage | null {
  if (!data || data.length < 3) return null
  const status = data[0] & 0xf0
  const channel = data[0] & 0x0f
  const number = data[1]
  const value = data[2]
  if (status === 0x90 && value > 0) return { type: 'note', channel, number, value }
  if (status === 0xb0) return { type: 'cc', channel, number, value }
  return null
}

export class MidiMapper {
  mappings: MidiMapping[] = []

  learn(mapping: MidiMapping): void {
    this.mappings = [...this.mappings.filter((item) => item.action !== mapping.action), mapping]
  }

  clear(action: MidiAction): void {
    this.mappings = this.mappings.filter((item) => item.action !== action)
  }

  /** Resolve an incoming message. Value 0 for notes is note-off and ignored. */
  handle(message: MidiMessage): MidiAction | null {
    if (message.type === 'note' && message.value === 0) return null
    const hit = this.mappings.find(
      (mapping) =>
        mapping.type === message.type &&
        mapping.number === message.number &&
        (mapping.channel == null || mapping.channel === message.channel),
    )
    return hit ? hit.action : null
  }

  /** A CC's value is used for continuous actions; returns the raw value too. */
  handleWithValue(message: MidiMessage): { action: MidiAction; value: number } | null {
    const action = this.handle(message)
    return action ? { action, value: message.value } : null
  }

  toJSON(): string {
    return JSON.stringify(this.mappings)
  }

  load(raw: string | null): void {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as MidiMapping[]
      if (Array.isArray(parsed)) {
        this.mappings = parsed.filter(
          (mapping) =>
            mapping &&
            typeof mapping.number === 'number' &&
            (mapping.type === 'note' || mapping.type === 'cc') &&
            MIDI_ACTIONS.some((item) => item.action === mapping.action),
        )
      }
    } catch {
      // ignore corrupt storage
    }
  }
}

const STORAGE_KEY = 'neiro.player.midi'

export function loadMidiMapper(): MidiMapper {
  const mapper = new MidiMapper()
  try {
    mapper.load(localStorage.getItem(STORAGE_KEY))
  } catch {
    // storage unavailable
  }
  return mapper
}

export function persistMidiMapper(mapper: MidiMapper): void {
  try {
    localStorage.setItem(STORAGE_KEY, mapper.toJSON())
  } catch {
    // storage full
  }
}
