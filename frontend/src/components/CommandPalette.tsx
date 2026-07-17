import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModuleId } from '../api/types'
import { useSession } from '../state/session'

export interface PaletteAction {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}

const MODULE_ACTIONS: { id: ModuleId; label: string; hint: string; key?: string }[] = [
  { id: 'import', label: 'Import', hint: 'Open a file or fetch a URL', key: '1' },
  { id: 'analysis', label: 'Analysis', hint: 'Report for the current file', key: '2' },
  { id: 'studio', label: 'Studio', hint: 'Timeline, edits, mix/export', key: '3' },
  { id: 'separate', label: 'Separate', hint: 'Stem separation', key: '4' },
  { id: 'restore', label: 'Restore', hint: 'Enhancement chains', key: '5' },
  { id: 'midi', label: 'MIDI Studio', hint: 'Transcribe / roll / score / edit / practice', key: '6' },
  { id: 'preferences', label: 'Preferences', hint: 'Theme, density, compute', key: '9' },
  { id: 'about', label: 'About', hint: 'Version, privacy, shortcuts' },
]

export function CommandPalette({
  open,
  onClose,
  extraActions = [],
}: {
  open: boolean
  onClose: () => void
  extraActions?: PaletteAction[]
}) {
  const { setModule, openStudioMix, clearSession, module, requestPracticeFocus } = useSession()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const actions = useMemo<PaletteAction[]>(() => {
    const mods: PaletteAction[] = MODULE_ACTIONS.map((m) => ({
      id: `mod-${m.id}`,
      label: m.label,
      hint: m.key ? `${m.hint} · ${m.key}` : m.hint,
      group: 'Modules',
      run: () => setModule(m.id),
    }))
    const builtins: PaletteAction[] = [
      {
        id: 'mix',
        label: 'Open Studio Mix',
        hint: 'Shortcut 7',
        group: 'Actions',
        run: () => openStudioMix(),
      },
      {
        id: 'midi-practice',
        label: 'MIDI Practice',
        hint: 'Shortcut 8',
        group: 'Actions',
        run: () => requestPracticeFocus(),
      },
      {
        id: 'new',
        label: 'New session',
        hint: 'Clear file and results',
        group: 'Actions',
        run: () => clearSession(),
      },
      ...extraActions,
    ]
    return [...mods, ...builtins]
  }, [setModule, openStudioMix, clearSession, requestPracticeFocus, extraActions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.hint?.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q),
    )
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const runAt = (idx: number) => {
    const item = filtered[idx]
    if (!item) return
    item.run()
    onClose()
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            runAt(active)
          }
        }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="search"
          placeholder="Jump to module or run an action…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-controls="palette-list"
          aria-activedescendant={filtered[active] ? `palette-${filtered[active].id}` : undefined}
        />
        <ul id="palette-list" className="palette-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && (
            <li className="palette-empty muted">No matches</li>
          )}
          {filtered.map((item, idx) => {
            const isMod = item.id.startsWith('mod-')
            const modId = isMod ? (item.id.replace('mod-', '') as ModuleId) : null
            return (
              <li key={item.id} role="option" aria-selected={idx === active}>
                <button
                  type="button"
                  id={`palette-${item.id}`}
                  data-idx={idx}
                  className={`palette-item${idx === active ? ' active' : ''}${
                    modId === module ? ' current' : ''
                  }`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => runAt(idx)}
                >
                  <span className="palette-item-main">
                    <span className="palette-item-label">{item.label}</span>
                    <span className="palette-item-group faint">{item.group}</span>
                  </span>
                  {item.hint && <span className="palette-item-hint mono muted">{item.hint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="palette-foot muted">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
