import { useEffect } from 'react'
import { useSession } from '../state/session'
import { MidiStudioModule } from './MidiStudioModule'

/** Legacy Learn module — redirects into MIDI Studio Practice. */
export function LearnModule() {
  const { requestPracticeFocus } = useSession()
  useEffect(() => {
    requestPracticeFocus()
  }, [requestPracticeFocus])
  return <MidiStudioModule />
}
