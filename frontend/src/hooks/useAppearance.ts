import { useEffect } from 'react'

import { useLocalPref } from '../api/hooks'

/**
 * Apply the saved theme, density, font scale and motion preference at startup.
 * Preferences also applies them on change (separate component state), so this
 * hook exists to stop the UI rendering in the wrong theme until Prefs is opened.
 */
export function useAppearance() {
  const [theme] = useLocalPref('neiro.pref.theme', 'dark')
  const [density] = useLocalPref('neiro.pref.density', 'comfortable')
  const [fontScale] = useLocalPref('neiro.pref.fontScale', '100')
  const [reducedMotion] = useLocalPref('neiro.pref.reducedMotion', 'system')

  useEffect(() => {
    const rootElement = document.documentElement
    rootElement.dataset.theme = theme
    rootElement.dataset.density = density
    rootElement.style.setProperty('--font-scale', `${Number(fontScale) / 100}`)
    if (reducedMotion === 'reduce') rootElement.dataset.reducedMotion = 'true'
    else if (reducedMotion === 'no-preference') rootElement.dataset.reducedMotion = 'false'
    else delete rootElement.dataset.reducedMotion
  }, [theme, density, fontScale, reducedMotion])
}
