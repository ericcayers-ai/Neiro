import { useEffect, useState } from 'react'
import { flushCompute } from '../api/client'
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
  const [flushing, setFlushing] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = density
    root.style.setProperty('--font-scale', `${Number(fontScale) / 100}`)
    if (reducedMotion === 'reduce') root.dataset.reducedMotion = 'true'
    else if (reducedMotion === 'no-preference') root.dataset.reducedMotion = 'false'
    else delete root.dataset.reducedMotion
  }, [theme, density, fontScale, reducedMotion])

  const onFlush = async () => {
    setFlushing(true)
    try {
      const res = await flushCompute()
      const n = res.flushed?.length ?? 0
      setStatus(
        n
          ? `Flushed ${n} resident model${n === 1 ? '' : 's'} from the warm pool.`
          : 'Warm pool already empty — nothing to flush.',
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setFlushing(false)
    }
  }

  return (
    <div className="module-panel">
      <h2>Preferences</h2>
      <p className="lede">
        Compute, storage, themes, and accessibility. Interface choices persist in this browser
        profile; warm-pool flush talks to the local engine.
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
          intent="Independent of OS zoom; supports up to 200%."
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
            onChange={(e) => setCacheBudget(e.target.value)}
          />
        </IntentField>
        <IntentField
          label="Warm-pool TTL (s)"
          intent="Preferred idle residency hint stored locally; Flush releases residents now."
          htmlFor="warm-ttl"
        >
          <input
            id="warm-ttl"
            type="number"
            min={0}
            max={3600}
            value={warmPoolTtl}
            onChange={(e) => setWarmPoolTtl(e.target.value)}
          />
        </IntentField>
        <button type="button" disabled={flushing} onClick={() => void onFlush()}>
          {flushing ? 'Flushing…' : 'Flush warm pool'}
        </button>
      </div>

      <h3>Privacy</h3>
      <p className="muted">
        No network access except model downloads and app updates, both user-initiated. No telemetry
        by default. Custom Python plugins under <span className="mono">~/.neiro/plugins</span> require
        an explicit grant.
      </p>

      {status && (
        <p className="muted" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  )
}
