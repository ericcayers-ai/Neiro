import { useCallback, useState } from 'react'

/** Local UI preference persisted in localStorage (theme, density, etc.). */
export function useLocalPref(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) || fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: string) => {
      setValue(v)
      try {
        localStorage.setItem(key, v)
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [value, set]
}

/** JSON-backed local preference (arrays/objects). */
export function useLocalJsonPref<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* ignore */
        }
        return next
      })
    },
    [key],
  )
  return [value, set]
}
