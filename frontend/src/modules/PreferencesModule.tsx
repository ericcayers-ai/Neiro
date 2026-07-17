import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelJob,
  fetchModelsFull,
  fetchPrefs,
  fetchToolsStatus,
  flushPrefs,
  getJob,
  installTool,
  setMuseScorePath,
  startModelDownload,
  updatePrefs,
  type ModelStatus,
  type ToolsStatus,
} from '../api/client'
import { useLocalPref } from '../api/hooks'
import { IntentField } from '../components/IntentField'
import { ModuleHeader } from '../components/ModuleHeader'
import './modules.css'

const PACK_LABELS: Record<string, string> = {
  separation: 'Separation',
  piano: 'Piano',
  restore: 'Restore',
  transcription: 'Transcription',
}

export function PreferencesModule() {
  const [theme, setTheme] = useLocalPref('neiro.pref.theme', 'dark')
  const [density, setDensity] = useLocalPref('neiro.pref.density', 'comfortable')
  const [fontScale, setFontScale] = useLocalPref('neiro.pref.fontScale', '100')
  const [reducedMotion, setReducedMotion] = useLocalPref('neiro.pref.reducedMotion', 'system')
  const [cacheBudget, setCacheBudget] = useLocalPref('neiro.pref.cacheBudgetGb', '20')
  const [warmPoolTtl, setWarmPoolTtl] = useLocalPref('neiro.pref.warmPoolTtl', '300')
  const [taskFilter, setTaskFilter] = useLocalPref('neiro.pref.modelsTask', 'all')
  const [status, setStatus] = useState('')
  const [engineBusy, setEngineBusy] = useState(false)
  const [residents, setResidents] = useState<string[]>([])
  const [models, setModels] = useState<ModelStatus[]>([])
  const [packs, setPacks] = useState<Record<string, string[]>>({})
  const [tools, setTools] = useState<ToolsStatus | null>(null)
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<string[]>([])
  const pollRef = useRef<number | null>(null)
  const museScoreInputRef = useRef<HTMLInputElement>(null)
  const [museScorePathDraft, setMuseScorePathDraft] = useState('')

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = density
    root.style.setProperty('--font-scale', `${Number(fontScale) / 100}`)
    if (reducedMotion === 'reduce') root.dataset.reducedMotion = 'true'
    else if (reducedMotion === 'no-preference') root.dataset.reducedMotion = 'false'
    else delete root.dataset.reducedMotion
  }, [theme, density, fontScale, reducedMotion])

  // Deep-link from MIDI Studio / elsewhere: scroll to Models or Tools once.
  useEffect(() => {
    let target: string | null = null
    try {
      target = sessionStorage.getItem('neiro.pref.scroll')
      if (target) sessionStorage.removeItem('neiro.pref.scroll')
    } catch {
      /* ignore */
    }
    if (!target) return
    const t = window.setTimeout(() => {
      document.getElementById(target!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [])

  const refreshModels = useCallback(async () => {
    try {
      const data = await fetchModelsFull()
      setModels(data.models)
      setPacks(data.packs || {})
    } catch {
      /* engine may be down */
    }
  }, [])

  const refreshTools = useCallback(async () => {
    try {
      const t = await fetchToolsStatus()
      setTools(t)
      if (t.musescore.path) setMuseScorePathDraft(t.musescore.path)
    } catch {
      /* ignore */
    }
  }, [])

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
    void refreshModels()
    void refreshTools()
    return () => {
      alive = false
    }
  }, [setCacheBudget, setWarmPoolTtl, refreshModels, refreshTools])

  useEffect(() => {
    if (!downloadJobId) return
    const poll = async () => {
      try {
        const j = await getJob(downloadJobId)
        setDownloadProgress(j.progress || [])
        if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
          setDownloadJobId(null)
          setStatus(
            j.status === 'done'
              ? 'Download finished.'
              : j.status === 'cancelled'
                ? 'Download cancelled.'
                : `Download failed: ${j.error || 'unknown'}`,
          )
          void refreshModels()
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch {
        /* ignore transient */
      }
    }
    void poll()
    pollRef.current = window.setInterval(() => void poll(), 500)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [downloadJobId, refreshModels])

  const filteredModels = useMemo(() => {
    if (taskFilter === 'all') return models
    return models.filter((m) => m.task === taskFilter || (taskFilter === 'transcribe' && m.task === 'transcribe-lyrics'))
  }, [models, taskFilter])

  const tasks = useMemo(() => {
    const s = new Set(models.map((m) => m.task))
    return ['all', ...Array.from(s).sort()]
  }, [models])

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

  const downloadOne = async (modelId: string) => {
    setStatus(`Starting download: ${modelId}…`)
    try {
      const { job_id } = await startModelDownload({ model_id: modelId })
      setDownloadJobId(job_id)
      setDownloadProgress([])
    } catch (err) {
      setStatus(`Download failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const downloadPack = async (pack: string) => {
    setStatus(`Starting ${PACK_LABELS[pack] || pack} pack…`)
    try {
      const { job_id } = await startModelDownload({ pack })
      setDownloadJobId(job_id)
      setDownloadProgress([])
    } catch (err) {
      setStatus(`Pack download failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const cancelDownload = async () => {
    if (!downloadJobId) return
    try {
      await cancelJob(downloadJobId)
      setStatus('Cancel requested…')
    } catch (err) {
      setStatus(`Couldn't cancel: ${err instanceof Error ? err.message : err}`)
    }
  }

  const onInstallVerovio = async () => {
    setEngineBusy(true)
    setStatus('Installing verovio via pip…')
    try {
      const r = await installTool('verovio')
      if (r.status) setTools(r.status)
      setStatus(r.ok ? 'Verovio installed.' : `Verovio install failed: ${r.error || 'see engine log'}`)
    } catch (err) {
      setStatus(`Verovio install failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setEngineBusy(false)
      void refreshTools()
    }
  }

  const onInstallSoundfont = async () => {
    setEngineBusy(true)
    setStatus('Downloading TimGM6mb.sf2 (GM soundfont)…')
    try {
      const r = await installTool('soundfont')
      if (r.status) setTools(r.status)
      setStatus(
        r.ok
          ? `Soundfont ready${r.path ? `: ${r.path}` : ''}. Browser piano uses FluidR3 GM samples; SF2 stays on disk for MuseScore.`
          : `Soundfont download failed: ${r.error || 'see engine log'}`,
      )
    } catch (err) {
      setStatus(`Soundfont download failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setEngineBusy(false)
      void refreshTools()
    }
  }

  const onSaveMuseScorePath = async (path: string | null) => {
    setEngineBusy(true)
    try {
      const r = await setMuseScorePath(path)
      if (r.status) setTools(r.status)
      if (r.ok) {
        setMuseScorePathDraft(r.path || '')
        setStatus(r.path ? `MuseScore path set: ${r.path}` : 'MuseScore override cleared (using PATH).')
      } else {
        setStatus(`Couldn't set MuseScore path: ${r.error || 'unknown'}`)
      }
    } catch (err) {
      setStatus(`Couldn't set MuseScore path: ${err instanceof Error ? err.message : err}`)
    } finally {
      setEngineBusy(false)
      void refreshTools()
    }
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title="Preferences"
        lede="Theme and density stay in this browser profile; models, cache, and tools sync to the local engine."
      />

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

      <h3 id="prefs-models">Models</h3>
      <p className="intent" style={{ marginTop: 0 }}>
        Download weights for available backends. Packs pull a starter set for each workflow.
      </p>
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        {Object.keys(packs).map((pack) => (
          <button
            key={pack}
            type="button"
            disabled={Boolean(downloadJobId)}
            onClick={() => void downloadPack(pack)}
            title={`Download: ${(packs[pack] || []).join(', ')}`}
          >
            {PACK_LABELS[pack] || pack} pack
          </button>
        ))}
        {downloadJobId && (
          <button type="button" onClick={() => void cancelDownload()}>
            Cancel download
          </button>
        )}
        <button type="button" onClick={() => void refreshModels()}>
          Refresh
        </button>
      </div>
      {downloadProgress.length > 0 && (
        <p className="muted mono" style={{ fontSize: '0.85rem' }}>
          {downloadProgress.slice(-3).join(' · ')}
        </p>
      )}
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <label className="field">
          Task filter
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
            {tasks.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="models-table-wrap">
        <table className="models-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Task</th>
              <th scope="col">Status</th>
              <th scope="col">Size</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.display_name}</strong>
                  <div className="mono muted" style={{ fontSize: '0.8rem' }}>
                    {m.id}
                  </div>
                </td>
                <td>{m.task}</td>
                <td>{m.status}</td>
                <td>{m.size_hint || '—'}</td>
                <td>
                  {m.status === 'ready' ? (
                    <span className="muted">Ready</span>
                  ) : m.status === 'needs-install' ? (
                    <span className="muted" title={(m.requires || []).join(', ')}>
                      Install deps
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(downloadJobId) || !m.available}
                      onClick={() => void downloadOne(m.id)}
                    >
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 id="prefs-tools">Tools</h3>
      <div className="option-detail">
        <div className="option-detail-title">Verovio</div>
        <p>
          {tools?.verovio.installed
            ? 'Installed — SVG score engraving available.'
            : tools?.verovio.hint || 'pip install verovio'}
        </p>
        {!tools?.verovio.installed && (
          <button type="button" disabled={engineBusy} onClick={() => void onInstallVerovio()}>
            Install Verovio
          </button>
        )}
      </div>
      <div className="option-detail" style={{ marginTop: '0.65rem' }}>
        <div className="option-detail-title">MuseScore</div>
        <p>
          {tools?.musescore.installed
            ? `Found: ${tools.musescore.path}`
            : 'Not on PATH — browse to MuseScore4.exe / mscore, or install for PDF export.'}
        </p>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={museScorePathDraft}
            disabled={engineBusy}
            placeholder="C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
            onChange={(e) => setMuseScorePathDraft(e.target.value)}
            style={{ flex: '1 1 16rem', minWidth: '12rem' }}
            aria-label="MuseScore executable path"
          />
          <button
            type="button"
            disabled={engineBusy || !museScorePathDraft.trim()}
            onClick={() => void onSaveMuseScorePath(museScorePathDraft.trim())}
          >
            Set path
          </button>
          <button type="button" disabled={engineBusy} onClick={() => museScoreInputRef.current?.click()}>
            Browse…
          </button>
          {tools?.musescore.installed && (
            <button type="button" className="ghost" disabled={engineBusy} onClick={() => void onSaveMuseScorePath(null)}>
              Clear override
            </button>
          )}
          {tools?.musescore.download_url && (
            <a className="btn-link" href={tools.musescore.download_url} target="_blank" rel="noreferrer">
              MuseScore download
            </a>
          )}
        </div>
        <input
          ref={museScoreInputRef}
          type="file"
          accept=".exe,.app,*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            // Browser file inputs do not expose full paths; use the name as a hint and ask for paste.
            // On Tauri/desktop, path may be available via webkitRelativePath — prefer Set path with full path.
            const anyFile = f as File & { path?: string }
            const full = typeof anyFile.path === 'string' ? anyFile.path : ''
            if (full) {
              setMuseScorePathDraft(full)
              void onSaveMuseScorePath(full)
            } else {
              setStatus(
                `Selected “${f.name}” — browsers hide full paths. Paste the full path to MuseScore4.exe and click Set path.`,
              )
              setMuseScorePathDraft(f.name)
            }
          }}
        />
      </div>
      <div className="option-detail" style={{ marginTop: '0.65rem' }}>
        <div className="option-detail-title">Soundfont</div>
        <p>
          {tools?.soundfont.installed
            ? `Present: ${tools.soundfont.files.join(', ')} — MIDI Studio piano unlocked (FluidR3 browser kit; SF2 for MuseScore).`
            : tools?.soundfont.hint || 'GM SF2 for MIDI Studio.'}
        </p>
        {!tools?.soundfont.installed && (
          <button type="button" disabled={engineBusy} onClick={() => void onInstallSoundfont()}>
            Download GM soundfont
          </button>
        )}
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
