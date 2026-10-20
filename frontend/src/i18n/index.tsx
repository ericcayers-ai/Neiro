import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { EN, dirFor, translate, type Catalogue } from './translate'

/**
 * App-wide i18n scaffold. English is the only shipped catalogue; the interface is
 * additive (new catalogues can be registered) and keeps the player's own catalogue
 * separate because those strings are owned by the player module.
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string

interface I18nValue {
  locale: string
  t: Translate
  setLocale: (locale: string) => void
  locales: string[]
}

const CATALOGUES: Record<string, Catalogue> = { en: EN }
const STORAGE_KEY = 'neiro.locale'

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored && CATALOGUES[stored] ? stored : 'en'
    } catch {
      return 'en'
    }
  })

  const setLocale = useCallback((next: string) => {
    if (!CATALOGUES[next]) return
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage unavailable: keep the in-memory locale
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    document.documentElement.dir = dirFor(locale)
  }, [locale])

  const value = useMemo<I18nValue>(() => {
    const catalogue = CATALOGUES[locale] ?? EN
    return {
      locale,
      setLocale,
      locales: Object.keys(CATALOGUES),
      t: (key, vars) => translate(catalogue, key, vars),
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): Translate {
  const value = useContext(I18nContext)
  if (!value) return (key, vars) => translate(EN, key, vars)
  return value.t
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) {
    return {
      locale: 'en',
      t: (key, vars) => translate(EN, key, vars),
      setLocale: () => undefined,
      locales: ['en'],
    }
  }
  return value
}
