import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keep Tab focus inside a modal while it is open, focus the first control on
 * open, and return focus to whatever opened it on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const items = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null && !element.hasAttribute('aria-hidden'),
      )
    const frame = window.requestAnimationFrame(() => items()[0]?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = items()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement as HTMLElement | null
      if (!current || !root.contains(current)) {
        // Focus already escaped (or never entered): pull it back.
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && (current === first || current === root)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey, true)
      // The opening control restores focus itself; restoring here raced with it
      // and could drop focus to <body> after the dialog closed.
    }
  }, [active, ref])
}
