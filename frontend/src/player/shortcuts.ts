/**
 * Remappable player keyboard shortcuts.
 *
 * Bindings are compared exactly (key + modifiers) and are exclusive: learning a
 * combination already used by another action removes it there, and reports the
 * replacement so the UI can say so. Persistence is local only.
 */

export type ShortcutAction =
  | 'play-pause'
  | 'seek-back'
  | 'seek-forward'
  | 'marker-add'
  | 'loop-toggle'
  | 'transpose-up'
  | 'transpose-down'
  | 'speed-up'
  | 'speed-down'

export const SHORTCUT_ACTIONS: { action: ShortcutAction; label: string }[] = [
  { action: 'play-pause', label: 'Play / pause' },
  { action: 'seek-back', label: 'Seek back' },
  { action: 'seek-forward', label: 'Seek forward' },
  { action: 'marker-add', label: 'Add marker' },
  { action: 'loop-toggle', label: 'A–B loop on/off' },
  { action: 'transpose-up', label: 'Transpose up' },
  { action: 'transpose-down', label: 'Transpose down' },
  { action: 'speed-up', label: 'Speed up' },
  { action: 'speed-down', label: 'Speed down' },
]

export interface KeyBinding {
  action: ShortcutAction
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

export const DEFAULT_BINDINGS: KeyBinding[] = [
  { action: 'play-pause', key: ' ', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'seek-back', key: 'arrowleft', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'seek-forward', key: 'arrowright', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'marker-add', key: 'm', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'loop-toggle', key: 'l', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'transpose-up', key: 'arrowup', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'transpose-down', key: 'arrowdown', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'speed-up', key: '+', ctrl: false, shift: false, alt: false, meta: false },
  { action: 'speed-down', key: '-', ctrl: false, shift: false, alt: false, meta: false },
]

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

/** Convert a keyboard event to a binding, or null for a bare modifier. */
export function eventToBinding(event: KeyEventLike): KeyBinding | null {
  const key = normalizeKey(event.key || '')
  if (!key || ['shift', 'control', 'alt', 'meta'].includes(key)) return null
  return {
    action: 'play-pause',
    key,
    ctrl: Boolean(event.ctrlKey),
    shift: Boolean(event.shiftKey),
    alt: Boolean(event.altKey),
    meta: Boolean(event.metaKey),
  }
}

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  escape: 'Esc',
  enter: 'Enter',
  home: 'Home',
  end: 'End',
}

export function bindingLabel(binding: KeyBinding | undefined): string {
  if (!binding) return '—'
  const parts: string[] = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.alt) parts.push('Alt')
  if (binding.shift) parts.push('Shift')
  if (binding.meta) parts.push('Meta')
  const key =
    NAMED_KEYS[binding.key] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  parts.push(key)
  return parts.join('+')
}

export function sameBinding(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.meta === b.meta
  )
}

export function conflictFor(
  bindings: KeyBinding[],
  candidate: KeyBinding,
  ignore: ShortcutAction | null = null,
): ShortcutAction | null {
  for (const binding of bindings) {
    if (binding.action === ignore) continue
    if (sameBinding(binding, candidate)) return binding.action
  }
  return null
}

export class ShortcutMap {
  bindings: KeyBinding[] = DEFAULT_BINDINGS.map((binding) => ({ ...binding }))

  /** Assign a binding to an action; returns actions it displaced. */
  learn(action: ShortcutAction, candidate: KeyBinding): ShortcutAction[] {
    const displaced = this.bindings
      .filter((binding) => binding.action !== action && sameBinding(binding, candidate))
      .map((binding) => binding.action)
    this.bindings = [
      ...this.bindings.filter((binding) => binding.action !== action && !sameBinding(binding, candidate)),
      { ...candidate, action },
    ]
    return displaced
  }

  clear(action: ShortcutAction): void {
    this.bindings = this.bindings.filter((binding) => binding.action !== action)
  }

  reset(): void {
    this.bindings = DEFAULT_BINDINGS.map((binding) => ({ ...binding }))
  }

  forAction(action: ShortcutAction): KeyBinding | undefined {
    return this.bindings.find((binding) => binding.action === action)
  }

  match(event: KeyEventLike): ShortcutAction | null {
    const candidate = eventToBinding(event)
    if (!candidate) return null
    const hit = this.bindings.find((binding) => sameBinding(binding, candidate))
    return hit ? hit.action : null
  }

  toJSON(): string {
    return JSON.stringify(this.bindings)
  }

  load(raw: string | null): void {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as KeyBinding[]
      if (!Array.isArray(parsed)) return
      const valid = parsed.filter(
        (binding) =>
          binding &&
          typeof binding.key === 'string' &&
          SHORTCUT_ACTIONS.some((item) => item.action === binding.action),
      )
      if (valid.length) this.bindings = valid
    } catch {
      // corrupt storage: keep defaults
    }
  }
}

const STORAGE_KEY = 'neiro.player.shortcuts'

export function loadShortcutMap(): ShortcutMap {
  const map = new ShortcutMap()
  try {
    map.load(localStorage.getItem(STORAGE_KEY))
  } catch {
    // storage unavailable
  }
  return map
}

export function persistShortcutMap(map: ShortcutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, map.toJSON())
  } catch {
    // storage full
  }
}
