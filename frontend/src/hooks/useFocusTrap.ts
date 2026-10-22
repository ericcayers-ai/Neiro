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
    const previous = document.activeElement as HTMLElement | null
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      root.removeEventListener('keydown', onKey)
      // Restore after React removes the dialog so focus is not dropped to <body>.
      window.requestAnimationFrame(() => previous?.focus?.())
    }
  }, [active, ref])
}
