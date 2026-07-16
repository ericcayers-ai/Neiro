import { useEffect, useState } from 'react'
import { fetchPrefs, flushPrefs, updatePrefs } from '../api/client'
import { useLocalPref } from '../api/hooks'
import { IntentField } from '../components/IntentField'
import './modules.css'

export function PreferencesModule() {
  const [theme, setTheme] = useLocalPref('neiro.pref.theme', 'dark')
  const [density, setDensity] = useLocalPref('neiro.pref.density', 'comfortable')
  const [fontScale, setFontScale] = useLocalPref('neiro.pref.fontScale', '100')
  const [reducedMotion, setReducedMotion] = useLocalPref('neiro.pref.reducedMotion', 'system')
  const [cacheBudget, setCacheBudget] = useLocalPref('neiro.pref.cacheBudgetGb', '20')
  const [warmPoolTtl, setWarmPoolTtl] = useLocalPref('neiro.pref.warmPoolTtl', '300')
  const [status, setStatus] = useState('')
  const [engineBusy, setEngineBusy] = useState(false)
  const [residents, setResidents] = useState<string[]>([])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = density
    root.style.setProperty('--font-scale', `${Number(fontScale) / 100}`)
    if (reducedMotion === 'reduce') root.dataset.reducedMotion = 'true'
    else if (reducedMotion === 'no-preference') root.dataset.reducedMotion = 'false'
    else delete root.dataset.reducedMotion
  }, [theme, density, fontScale, reducedMotion])

  useEffect(() => {
    let alive = true
    void fetchPrefs()
      .then((p) => {
        if (!alive) return
        setCacheBudget(String(p.cache_budget_gb))
        setWarmPoolTtl(String(p.warm_pool_ttl_s))
        setResidents(p.resident_models || [])
      })
      .catch(() => {
        /* engine may be down during first paint */
      })
    return () => {
      alive = false
    }
  }, [setCacheBudget, setWarmPoolTtl])

  const syncCompute = async () => {
    setEngineBusy(true)
    setStatus('Saving compute prefs…')
    try {
      const p = await updatePrefs({
        cache_budget_gb: Number(cacheBudget),
        warm_pool_ttl_s: Number(warmPoolTtl),
      })
      setResidents(p.resident_models || [])
      setStatus(
        `Engine prefs applied — cache budget ${p.cache_budget_gb} GB, warm-pool TTL ${p.warm_pool_ttl_s}s.`,
      )
    } catch (err) {
      setStatus(`Couldn't update engine prefs: ${err instanceof Error ? err.message : err}`)
    } finally {
      setEngineBusy(false)
    }
  }

  const onFlush = async (clearCache = false) => {
    setEngineBusy(true)
    setStatus(clearCache ? 'Flushing warm pool and clearing cache…' : 'Flushing warm pool…')
    try {
      const p = await flushPrefs(clearCache)
      setResidents(p.resident_models || [])
      const n = p.flushed_models?.length ?? 0
      const parts = [
        n
          ? `Flushed ${n} resident model${n === 1 ? '' : 's'}`
          : 'Warm pool was already empty',
      ]
      if (p.cache_cleared) parts.push('artifact cache cleared')
      setStatus(`${parts.join('; ')}.`)
    } catch (err) {
      setStatus(`Couldn't flush warm pool: ${err instanceof Error ? err.message : err}`)
    } finally {
      setEngineBusy(false)
    }
  }

  return (
    <div className="module-panel">
      <h2>Preferences</h2>
      <p className="lede">
        Compute, storage, audio defaults, themes, and accessibility. Interface choices persist in
        this browser profile; cache and warm-pool settings sync to the local engine.
      </p>

      <h3>Interface</h3>
      <div className="row">
        <IntentField label="Theme" intent="Dark, light, and high-contrast are first-class." htmlFor="theme">
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">Dark (ink-on-slate)</option>
            <option value="light">Light</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </IntentField>
        <IntentField label="Density" intent="Compact reduces padding for dense editing." htmlFor="density">
          <select id="density" value={density} onChange={(e) => setDensity(e.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </IntentField>
        <IntentField
          label="Font scale"
          intent="Independent of OS zoom; supports up to 200%. Scales rem-based UI."
          htmlFor="font-scale"
        >
          <select id="font-scale" value={fontScale} onChange={(e) => setFontScale(e.target.value)}>
            <option value="90">90%</option>
            <option value="100">100%</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
            <option value="200">200%</option>
          </select>
        </IntentField>
        <IntentField
          label="Motion"
          intent="Honor prefers-reduced-motion or force reduce."
          htmlFor="motion"
        >
          <select
            id="motion"
            value={reducedMotion}
            onChange={(e) => setReducedMotion(e.target.value)}
          >
            <option value="system">System</option>
            <option value="reduce">Reduce</option>
            <option value="no-preference">No preference</option>
          </select>
        </IntentField>
      </div>

      <h3>Compute &amp; storage</h3>
      <div className="row">
        <IntentField
          label="Cache budget (GB)"
          intent="LRU eviction when the content-addressed cache exceeds this size."
          htmlFor="cache-budget"
        >
          <input
            id="cache-budget"
            type="number"
            min={1}
            max={500}
            value={cacheBudget}
            disabled={engineBusy}
            onChange={(e) => setCacheBudget(e.target.value)}
            onBlur={() => void syncCompute()}
          />
        </IntentField>
        <IntentField
          label="Warm-pool TTL (s)"
          intent="How long models stay resident between jobs. 0 disables auto-eviction."
          htmlFor="warm-ttl"
        >
          <input
            id="warm-ttl"
            type="number"
            min={0}
            max={3600}
            value={warmPoolTtl}
            disabled={engineBusy}
            onChange={(e) => setWarmPoolTtl(e.target.value)}
            onBlur={() => void syncCompute()}
          />
        </IntentField>
        <button type="button" disabled={engineBusy} onClick={() => void syncCompute()}>
          Apply to engine
        </button>
        <button type="button" disabled={engineBusy} onClick={() => void onFlush(false)}>
          Flush warm pool
        </button>
        <button type="button" disabled={engineBusy} onClick={() => void onFlush(true)}>
          Flush + clear cache
        </button>
      </div>
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        Resident models:{' '}
        {residents.length > 0 ? residents.join(', ') : 'none (warm pool empty)'}
      </p>
      <p className="faint" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
        Watch-folder batching is CLI-only:{' '}
        <code>neiro watch ./inbox --out ./done --job separate</code>. DAWproject zip export is
        available from the engine API/tests path — not a Prefs toggle.
      </p>

      <h3>Privacy</h3>
      <p className="muted">
        No network access except model downloads and app updates, both user-initiated. No telemetry
        by default.
      </p>

      {status && (
        <p className="muted" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  )
}
