import { useEffect } from 'react'
import { AppShell } from './shell/AppShell'
import { SessionProvider, useSession } from './state/session'
import { ImportModule } from './modules/ImportModule'
import { AnalysisModule } from './modules/AnalysisModule'
import { StudioModule } from './modules/StudioModule'
import { SeparateModule } from './modules/SeparateModule'
import { RestoreModule } from './modules/RestoreModule'
import { MidiStudioModule } from './modules/MidiStudioModule'
import { PreferencesModule } from './modules/PreferencesModule'
import { AboutModule } from './modules/AboutModule'
import type { ModuleId } from './api/types'

function ModuleSwitcher() {
  const { module, setModule, openStudioMix, requestPracticeFocus } = useSession()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      // Legacy "7 = Mixer" opens Studio Mix drawer.
      if (e.key === '7') {
        openStudioMix()
        return
      }
      // 8 → MIDI Studio Practice focus (former Learn).
      if (e.key === '8') {
        requestPracticeFocus()
        return
      }
      const map: Record<string, ModuleId> = {
        '1': 'import',
        '2': 'analysis',
        '3': 'studio',
        '4': 'separate',
        '5': 'restore',
        '6': 'midi',
        '9': 'preferences',
      }
      if (map[e.key]) setModule(map[e.key])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setModule, openStudioMix, requestPracticeFocus])

  switch (module) {
    case 'import':
      return <ImportModule />
    case 'analysis':
      return <AnalysisModule />
    case 'studio':
    case 'mixer':
      return <StudioModule />
    case 'separate':
      return <SeparateModule />
    case 'restore':
      return <RestoreModule />
    case 'midi':
    case 'transcribe':
    case 'learn':
      return <MidiStudioModule />
    case 'preferences':
      return <PreferencesModule />
    case 'about':
      return <AboutModule />
    default:
      return <ImportModule />
  }
}

export default function App() {
  return (
    <SessionProvider>
      <AppShell>
        <ModuleSwitcher />
      </AppShell>
    </SessionProvider>
  )
}
