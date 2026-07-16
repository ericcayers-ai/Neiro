import { useEffect } from 'react'
import { useSession } from '../state/session'

/** Legacy entry: Mixer is folded into Studio Mix. Redirects on mount. */
export function MixerModule() {
  const { openStudioMix } = useSession()

  useEffect(() => {
    openStudioMix()
  }, [openStudioMix])

  return (
    <div className="module-panel">
      <h2>Mixer</h2>
      <p className="muted">Opening Studio Mix…</p>
    </div>
  )
}
