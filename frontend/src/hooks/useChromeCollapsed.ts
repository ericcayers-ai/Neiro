import { useCallback, useState } from 'react'

/** Persist a collapsed chrome preference in localStorage. */
export function useChromeCollapsed(
  storageKey: string,
  defaultCollapsed = false,
): [boolean, (next?: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      /* ignore */
    }
    return defaultCollapsed
  })

  const set = useCallback(
    (next?: boolean) => {
      setCollapsed((prev) => {
        const value = typeof next === 'boolean' ? next : !prev
        try {
          localStorage.setItem(storageKey, value ? '1' : '0')
        } catch {
          /* ignore */
        }
        return value
      })
    },
    [storageKey],
  )

  return [collapsed, set]
}
