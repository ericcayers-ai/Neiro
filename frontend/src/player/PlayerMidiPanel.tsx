import { useCallback, useEffect, useRef, useState } from 'react'

import {
  MIDI_ACTIONS,
  MidiMapper,
  loadMidiMapper,
  parseMidiMessage,
  persistMidiMapper,
  type MidiAction,
  type MidiMapping,
} from './midi'
import { t } from './i18n'

/**
 * MIDI learn panel. One mapping service, any connected device, persisted locally.
 * Learn captures the next note/CC from any input; Clear removes one binding.
 */
export function PlayerMidiPanel({ onAction }: { onAction: (action: MidiAction) => void }) {
  const mapperRef = useRef<MidiMapper>(loadMidiMapper())
  const learningRef = useRef<MidiAction | null>(null)
  const actionRef = useRef(onAction)
  actionRef.current = onAction
  const [mappings, setMappings] = useState<MidiMapping[]>(mapperRef.current.mappings)
  const [learning, setLearning] = useState<MidiAction | null>(null)
  const [devices, setDevices] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const accessRef = useRef<MIDIAccess | null>(null)

  learningRef.current = learning

  const onMessage = useCallback((event: MIDIMessageEvent) => {
    const message = parseMidiMessage(event.data ?? [])
    if (!message) return
    const learningAction = learningRef.current
    if (learningAction) {
      mapperRef.current.learn({
        action: learningAction,
        type: message.type,
        number: message.number,
        channel: message.channel,
      })
      persistMidiMapper(mapperRef.current)
      setMappings([...mapperRef.current.mappings])
      setLearning(null)
      return
    }
    const hit = mapperRef.current.handle(message)
    if (hit) actionRef.current(hit)
  }, [])

  const attach = useCallback(
    (access: MIDIAccess) => {
      accessRef.current = access
      const inputs = [...access.inputs.values()]
      setDevices(inputs.map((input) => input.name || 'MIDI input'))
      setConnected(inputs.length > 0)
      for (const input of inputs) {
        input.onmidimessage = onMessage as (event: MIDIMessageEvent) => void
      }
    },
    [onMessage],
  )

  const connect = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      setError('WebMIDI is not available in this browser.')
      return
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      attach(access)
      access.onstatechange = () => attach(access)
      setError('')
    } catch {
      setError('WebMIDI permission denied.')
    }
  }, [attach])

  useEffect(() => {
    return () => {
      const access = accessRef.current
      if (!access) return
      for (const input of access.inputs.values()) input.onmidimessage = null
    }
  }, [])

  const mappingFor = (action: MidiAction) => mappings.find((item) => item.action === action)

  return (
    <details className="player-midi">
      <summary>
        {t('player.midi')} ({t('player.midiMapped', { count: mappings.length })})
      </summary>
      <div className="row" style={{ marginTop: '0.4rem' }}>
        <button type="button" onClick={() => void connect()}>
          {connected ? t('player.midiRefresh') : t('player.midiEnable')}
        </button>
        <span className="intent">
          {connected ? t('player.midiConnected', { count: devices.length }) : t('player.midiNone')}
        </span>
      </div>
      {error && <p className="player-error">{error}</p>}
      <ul className="player-list">
        {MIDI_ACTIONS.map((item) => {
          const mapping = mappingFor(item.action)
          return (
            <li key={item.action}>
              <span>{item.label}</span>
              <span className="intent">
                {mapping
                  ? `${mapping.type.toUpperCase()} ${mapping.number}${mapping.channel != null ? ` ch ${mapping.channel + 1}` : ''}`
                  : '—'}
              </span>
              <button
                type="button"
                className={learning === item.action ? 'active' : ''}
                onClick={() => setLearning(learning === item.action ? null : item.action)}
              >
                {learning === item.action ? t('player.midiListening') : t('player.midiLearn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  mapperRef.current.clear(item.action)
                  persistMidiMapper(mapperRef.current)
                  setMappings([...mapperRef.current.mappings])
                }}
              >
                {t('player.midiClear')}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="intent">{t('player.midiHint')}</p>
    </details>
  )
}
