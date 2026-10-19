import { useState } from 'react'

const PLAYER_PREFIX = 'neiro.player.'
const MIDI_KEY = 'neiro.player.midi'

function clearPlayerStorage(): number {
  let removed = 0
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (key && key.startsWith(PLAYER_PREFIX)) {
      localStorage.removeItem(key)
      removed += 1
    }
  }
  return removed
}

/**
 * Data-reset panel: clears only local player scratch state (settings, scenes,
 * markers/clips, MIDI mappings). It never deletes audio files, the library
 * database, model weights or sessions.
 */
export function DataResetCard() {
  const [status, setStatus] = useState('')

  const resetPlayer = () => {
    if (!window.confirm('Clear player settings, scenes, markers, clips and MIDI mappings?')) return
    const removed = clearPlayerStorage()
    setStatus(`Cleared ${removed} local player entr${removed === 1 ? 'y' : 'ies'}.`)
  }

  const resetMidi = () => {
    if (!window.confirm('Clear all MIDI mappings?')) return
    localStorage.removeItem(MIDI_KEY)
    setStatus('MIDI mappings cleared.')
  }

  return (
    <section aria-labelledby="prefs-data">
      <h3 id="prefs-data">Data and reset</h3>
      <p className="muted">
        Local player data only. Audio files, the library database, sessions and model weights are
        never touched here; use the Library module for songs and Prefs → Compute for the cache.
      </p>
      <div className="row">
        <button type="button" onClick={resetPlayer}>
          Clear player data
        </button>
        <button type="button" onClick={resetMidi}>
          Clear MIDI mappings
        </button>
      </div>
      {status && (
        <p className="muted" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </section>
  )
}
