import { useEffect, useRef, useState } from 'react'

import {
  SHORTCUT_ACTIONS,
  ShortcutMap,
  bindingLabel,
  eventToBinding,
  loadShortcutMap,
  persistShortcutMap,
  type ShortcutAction,
} from './shortcuts'
import { t } from './i18n'

/**
 * Keyboard shortcut editor. Click Learn, press a combination, done. Conflicts
 * displace the previous action and are reported; Reset restores defaults.
 */
export function PlayerShortcutPanel() {
  const mapRef = useRef<ShortcutMap>(loadShortcutMap())
  const [bindings, setBindings] = useState(() => [...mapRef.current.bindings])
  const [learning, setLearning] = useState<ShortcutAction | null>(null)
  const [message, setMessage] = useState('')
  const learningRef = useRef<ShortcutAction | null>(null)
  learningRef.current = learning

  useEffect(() => {
    if (!learning) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const candidate = eventToBinding(event)
      if (!candidate) return
      const action = learningRef.current
      if (!action) return
      const displaced = mapRef.current.learn(action, candidate)
      persistShortcutMap(mapRef.current)
      setBindings([...mapRef.current.bindings])
      setLearning(null)
      setMessage(
        displaced.length
          ? t('player.shortcutDisplaced', { actions: displaced.join(', ') })
          : t('player.shortcutAssigned'),
      )
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [learning])

  return (
    <details className="player-midi">
      <summary>
        {t('player.keyboard')} ({t('player.keyboardBound', { count: bindings.length })})
      </summary>
      <ul className="player-list">
        {SHORTCUT_ACTIONS.map((item) => (
          <li key={item.action}>
            <span>{item.label}</span>
            <span className="intent">{bindingLabel(mapRef.current.forAction(item.action))}</span>
            <button
              type="button"
              className={learning === item.action ? 'active' : ''}
              onClick={() => setLearning(learning === item.action ? null : item.action)}
            >
              {learning === item.action ? t('player.pressKey') : t('player.midiLearn')}
            </button>
            <button
              type="button"
              onClick={() => {
                mapRef.current.clear(item.action)
                persistShortcutMap(mapRef.current)
                setBindings([...mapRef.current.bindings])
              }}
            >
              {t('player.midiClear')}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            mapRef.current.reset()
            persistShortcutMap(mapRef.current)
            setBindings([...mapRef.current.bindings])
            setMessage(t('player.resetDefaults'))
          }}
        >
          {t('player.resetDefaults')}
        </button>
        <span className="intent">{t('player.waitFixed')}</span>
      </div>
      {message && (
        <p className="intent" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </details>
  )
}
