import { useCallback, useEffect, useState } from 'react'

interface PairInfo {
  code: string
  expires_at: number
  ttl_s: number
}

/**
 * Pairing card for the optional browser companion. The code is a short-lived,
 * local-only secret: it is shown to the same-origin UI, exchanged by the extension
 * for the API token, and rotated after use.
 */
export function CompanionCard() {
  const [pair, setPair] = useState<PairInfo | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/pair/code', { cache: 'no-store' })
      if (!res.ok) throw new Error(`pairing code unavailable (${res.status})`)
      setPair((await res.json()) as PairInfo)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const copy = async () => {
    if (!pair) return
    setBusy(true)
    try {
      await navigator.clipboard.writeText(pair.code)
      setStatus('Pairing code copied.')
    } catch {
      setStatus(`Copy failed — the code is ${pair.code}`)
    } finally {
      setBusy(false)
    }
  }

  const minutes = pair ? Math.max(0, Math.round((pair.expires_at * 1000 - Date.now()) / 60000)) : 0

  return (
    <section aria-labelledby="prefs-companion">
      <h3 id="prefs-companion">Companion (optional browser addon)</h3>
      <p className="muted">
        The MV3 companion adds real-time tab transpose and a paired queued hand-off. Neiro works
        without it; nothing is required for the app, and there is no cloud account.
      </p>
      <p className="muted">
        Engine URL for the extension:{' '}
        <code className="mono">{typeof window !== 'undefined' ? window.location.origin : ''}</code>{' '}
        — paste it into the companion&apos;s Engine URL field. It changes when the desktop picks a
        dynamic port.
      </p>
      {pair ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <code
            className="mono"
            style={{ fontSize: '1.4rem', letterSpacing: '0.25em' }}
            aria-label="Companion pairing code"
          >
            {pair.code}
          </code>
          <button type="button" onClick={() => void copy()} disabled={busy}>
            Copy code
          </button>
          <span className="intent">expires in ~{minutes} min · rotates after pairing</span>
        </div>
      ) : (
        <p className="muted">Pairing code unavailable.</p>
      )}
      <p className="intent">
        In the companion: open the side panel → paste the code → Pair. Then Start tab capture. Only
        audio the browser is allowed to play is processed; no DRM bypass. See docs/COMPANION.md.
      </p>
      {status && (
        <p className="muted" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </section>
  )
}
