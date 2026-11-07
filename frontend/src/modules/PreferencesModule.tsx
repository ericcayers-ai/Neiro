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
  removeModel,
  startModelDownload,
  updatePrefs,
  type ModelStatus,
  type ToolsStatus,
} from '../api/client'
import { useLocalPref } from '../api/hooks'
import { IntentField } from '../components/IntentField'
import { ModuleHeader } from '../components/ModuleHeader'
import { usePlural, useT } from '../i18n'
import { CompanionCard } from './CompanionCard'
import { DataResetCard } from './DataResetCard'
import './modules.css'

/** Pack id → catalogue key; unknown pack ids fall back to their raw name. */
const PACK_KEYS: Record<string, string> = {
  separation: 'prefs.pack.separation',
  piano: 'prefs.pack.piano',
  restore: 'prefs.pack.restore',
  transcription: 'prefs.pack.transcription',
}

export function PreferencesModule() {
  const t = useT()
  const plural = usePlural()
  const packLabel = (pack: string) => (PACK_KEYS[pack] ? t(PACK_KEYS[pack]) : pack)
  const [theme, setTheme] = useLocalPref('neiro.pref.theme', 'dark')
  const [density, setDensity] = useLocalPref('neiro.pref.density', 'comfortable')
  const [fontScale, setFontScale] = useLocalPref('neiro.pref.fontScale', '100')
  const [reducedMotion, setReducedMotion] = useLocalPref('neiro.pref.reducedMotion', 'system')
  const [cacheBudget, setCacheBudget] = useLocalPref('neiro.pref.cacheBudgetGb', '20')
  const [cacheEffective, setCacheEffective] = useState<number | null>(null)
  const [diskFree, setDiskFree] = useState<number | null>(null)
  const [warmPoolTtl, setWarmPoolTtl] = useLocalPref('neiro.pref.warmPoolTtl', '300')
  const [taskFilter, setTaskFilter] = useLocalPref('neiro.pref.modelsTask', 'all')
  const [status, setStatus] = useState('')
  const [openPlayer, setOpenPlayer] = useState<boolean>(() => {
    try {
      return localStorage.getItem('neiro.prefs.openPlayerAfterImport') === '1'
    } catch {
      return false
    }
  })
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
      setCacheEffective(Number(p.cache_budget_effective_gb))
      setDiskFree(Number(p.disk_free_gb))
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
              ? t('prefs.status.downloadFinished')
              : j.status === 'cancelled'
                ? t('prefs.status.downloadCancelled')
                : t('prefs.status.downloadFailed', { error: j.error || t('prefs.status.unknown') }),
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
  }, [downloadJobId, refreshModels, t])

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
    setStatus(t('prefs.status.savingCompute'))
    try {
      const p = await updatePrefs({
        cache_budget_gb: Number(cacheBudget),
        warm_pool_ttl_s: Number(warmPoolTtl),
      })
      setResidents(p.resident_models || [])
      setCacheEffective(Number(p.cache_budget_effective_gb))
      setDiskFree(Number(p.disk_free_gb))
      setStatus(
        t('prefs.status.computeApplied', {
          gb: p.cache_budget_gb,
          ttl: p.warm_pool_ttl_s,
        }),
      )
    } catch (err) {
      setStatus(t('prefs.status.computeFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setEngineBusy(false)
    }
  }

  const onFlush = async (clearCache = false) => {
    setEngineBusy(true)
    setStatus(clearCache ? t('prefs.status.flushingClear') : t('prefs.status.flushing'))
    try {
      const p = await flushPrefs(clearCache)
      setResidents(p.resident_models || [])
      const n = p.flushed_models?.length ?? 0
      const parts = [
        n ? plural('prefs.status.flushed', n) : t('prefs.status.poolEmpty'),
      ]
      if (p.cache_cleared) parts.push(t('prefs.status.cacheCleared'))
      setStatus(`${parts.join('; ')}.`)
    } catch (err) {
      setStatus(t('prefs.status.flushFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setEngineBusy(false)
    }
  }

  const removeOne = async (modelId: string) => {
    if (!window.confirm(t('prefs.removeWeightsConfirm', { name: modelId }))) {
      return
    }
    setStatus(t('prefs.status.removing', { name: modelId }))
    try {
      const result = await removeModel(modelId)
      setStatus(
        t('prefs.status.removed', { name: modelId, mb: Math.round(result.freed_bytes / 1e6) }),
      )
      await refreshModels()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const downloadOne = async (modelId: string) => {
    setStatus(t('prefs.status.downloadStarting', { name: modelId }))
    try {
      const { job_id } = await startModelDownload({ model_id: modelId })
      setDownloadJobId(job_id)
      setDownloadProgress([])
    } catch (err) {
      setStatus(t('prefs.status.downloadFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const downloadPack = async (pack: string) => {
    setStatus(t('prefs.status.packStarting', { label: packLabel(pack) }))
    try {
      const { job_id } = await startModelDownload({ pack })
      setDownloadJobId(job_id)
      setDownloadProgress([])
    } catch (err) {
      setStatus(t('prefs.status.packFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const cancelDownload = async () => {
    if (!downloadJobId) return
    try {
      await cancelJob(downloadJobId)
      setStatus(t('prefs.status.cancelRequested'))
    } catch (err) {
      setStatus(t('prefs.status.cancelFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const onInstallVerovio = async () => {
    setEngineBusy(true)
    setStatus(t('prefs.status.installingVerovio'))
    try {
      const r = await installTool('verovio')
      if (r.status) setTools(r.status)
      setStatus(
        r.ok
          ? t('prefs.status.verovioInstalled')
          : t('prefs.status.verovioFailed', { error: r.error || t('prefs.status.seeEngineLog') }),
      )
    } catch (err) {
      setStatus(t('prefs.status.verovioFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setEngineBusy(false)
      void refreshTools()
    }
  }

  const onInstallSoundfont = async () => {
    setEngineBusy(true)
    setStatus(t('prefs.status.downloadingSoundfont'))
    try {
      const r = await installTool('soundfont')
      if (r.status) setTools(r.status)
      setStatus(
        r.ok
          ? t('prefs.status.soundfontReady', { path: r.path ? `: ${r.path}` : '' })
          : t('prefs.status.soundfontFailed', { error: r.error || t('prefs.status.seeEngineLog') }),
      )
    } catch (err) {
      setStatus(t('prefs.status.soundfontFailed', { error: err instanceof Error ? err.message : String(err) }))
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
        setStatus(
          r.path
            ? t('prefs.status.musePathSet', { path: r.path })
            : t('prefs.status.musePathCleared'),
        )
      } else {
        setStatus(t('prefs.status.musePathFailed', { error: r.error || t('prefs.status.unknown') }))
      }
    } catch (err) {
      setStatus(t('prefs.status.musePathFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setEngineBusy(false)
      void refreshTools()
    }
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title={t('prefs.title')}
        lede={t('prefs.lede')}
      />

      <h3>{t('prefs.interface')}</h3>
      <div className="row">
        <IntentField label={t('prefs.theme')} intent={t('prefs.themeIntent')} htmlFor="theme">
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">{t('prefs.themeDark')}</option>
            <option value="light">{t('prefs.themeLight')}</option>
            <option value="high-contrast">{t('prefs.themeHigh')}</option>
          </select>
        </IntentField>
        <IntentField label={t('prefs.density')} intent={t('prefs.densityIntent')} htmlFor="density">
          <select id="density" value={density} onChange={(e) => setDensity(e.target.value)}>
            <option value="comfortable">{t('prefs.densityComfortable')}</option>
            <option value="compact">{t('prefs.densityCompact')}</option>
          </select>
        </IntentField>
        <IntentField
          label={t('prefs.fontScale')}
          intent={t('prefs.fontScaleIntent')}
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
          label={t('prefs.motion')}
          intent={t('prefs.motionIntent')}
          htmlFor="motion"
        >
          <select
            id="motion"
            value={reducedMotion}
            onChange={(e) => setReducedMotion(e.target.value)}
          >
            <option value="system">{t('prefs.motionSystem')}</option>
            <option value="reduce">{t('prefs.motionReduce')}</option>
            <option value="no-preference">{t('prefs.motionNoPreference')}</option>
          </select>
        </IntentField>

      <label className="inline" style={{ marginTop: '0.6rem' }}>
        <input
          type="checkbox"
          checked={openPlayer}
          onChange={(event) => {
            const next = event.target.checked
            setOpenPlayer(next)
            try {
              localStorage.setItem('neiro.prefs.openPlayerAfterImport', next ? '1' : '0')
            } catch {
              /* ignore */
            }
          }}
        />{' '}
        {t('prefs.openPlayer')}
      </label>
      </div>

      <h3 id="prefs-models">{t('prefs.models')}</h3>
      <p className="intent" style={{ marginTop: 0 }}>
        {t('prefs.modelsIntent')}
      </p>
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        {Object.keys(packs).map((pack) => (
          <button
            key={pack}
            type="button"
            disabled={Boolean(downloadJobId)}
            onClick={() => void downloadPack(pack)}
            title={t('prefs.packDownloadTitle', { list: (packs[pack] || []).join(', ') })}
          >
            {t('prefs.packLabel', { label: packLabel(pack) })}
          </button>
        ))}
        {downloadJobId && (
          <button type="button" onClick={() => void cancelDownload()}>
            {t('prefs.cancelDownload')}
          </button>
        )}
        <button type="button" onClick={() => void refreshModels()}>
          {t('prefs.refresh')}
        </button>
      </div>
      {downloadProgress.length > 0 && (
        <p className="muted mono" style={{ fontSize: '0.85rem' }}>
          {downloadProgress.slice(-3).join(' · ')}
        </p>
      )}
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <label className="field">
          {t('prefs.taskFilter')}
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
              <th scope="col">{t('prefs.model')}</th>
              <th scope="col">{t('prefs.task')}</th>
              <th scope="col">{t('prefs.status')}</th>
              <th scope="col">{t('prefs.size')}</th>
              <th scope="col">{t('prefs.action')}</th>
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
                  {m.needs_download && m.downloaded && (
                    <button
                      type="button"
                      disabled={Boolean(downloadJobId)}
                      onClick={() => void removeOne(m.id)}
                    >
                      {t('prefs.remove')}
                    </button>
                  )}{' '}
                  {m.status === 'ready' ? (
                    <span className="muted">{t('prefs.ready')}</span>
                  ) : m.status === 'needs-install' ? (
                    <span className="muted" title={(m.requires || []).join(', ')}>
                      {t('prefs.installDeps')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(downloadJobId) || !m.available}
                      onClick={() => void downloadOne(m.id)}
                    >
                      {t('prefs.download')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 id="prefs-tools">{t('prefs.tools')}</h3>
      <div className="option-detail">
        <div className="option-detail-title">{t('prefs.verovio')}</div>
        <p>
          {tools?.verovio.installed
            ? t('prefs.verovioReady')
            : tools?.verovio.hint || t('prefs.verovioHint')}
        </p>
        {!tools?.verovio.installed && (
          <button type="button" disabled={engineBusy} onClick={() => void onInstallVerovio()}>
            {t('prefs.installVerovio')}
          </button>
        )}
      </div>
      <div className="option-detail" style={{ marginTop: '0.65rem' }}>
        <div className="option-detail-title">{t('prefs.musescore')}</div>
        <p>
          {tools?.musescore.installed
            ? t('prefs.musescoreFound', { path: tools.musescore.path ?? '' })
            : t('prefs.musescoreMissing')}
        </p>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={museScorePathDraft}
            disabled={engineBusy}
            placeholder="C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
            onChange={(e) => setMuseScorePathDraft(e.target.value)}
            style={{ flex: '1 1 16rem', minWidth: '12rem' }}
            aria-label={t('prefs.musePath')}
          />
          <button
            type="button"
            disabled={engineBusy || !museScorePathDraft.trim()}
            onClick={() => void onSaveMuseScorePath(museScorePathDraft.trim())}
          >
            {t('prefs.setPath')}
          </button>
          <button type="button" disabled={engineBusy} onClick={() => museScoreInputRef.current?.click()}>
            {t('prefs.browse')}
          </button>
          {tools?.musescore.installed && (
            <button type="button" className="ghost" disabled={engineBusy} onClick={() => void onSaveMuseScorePath(null)}>
              {t('prefs.clearOverride')}
            </button>
          )}
          {tools?.musescore.download_url && (
            <a className="btn-link" href={tools.musescore.download_url} target="_blank" rel="noreferrer">
              {t('prefs.museDownload')}
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
                t('prefs.status.museFileHint', { name: f.name }),
              )
              setMuseScorePathDraft(f.name)
            }
          }}
        />
      </div>
      <div className="option-detail" style={{ marginTop: '0.65rem' }}>
        <div className="option-detail-title">{t('prefs.soundfont')}</div>
        <p>
          {tools?.soundfont.installed
            ? t('prefs.soundfontReady', { files: tools.soundfont.files.join(', ') })
            : tools?.soundfont.hint || t('prefs.soundfontHint')}
        </p>
        {!tools?.soundfont.installed && (
          <button type="button" disabled={engineBusy} onClick={() => void onInstallSoundfont()}>
            {t('prefs.downloadSf')}
          </button>
        )}
      </div>

      <h3>{t('prefs.compute')}</h3>
      <div className="row">
        <IntentField
          label={t('prefs.cacheBudget')}
          intent={t('prefs.cacheIntent')}
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
        {cacheEffective !== null && (
          <p className="intent" role="status">
            {t('prefs.effectiveBudget', {
              gb: cacheEffective.toFixed(2),
              free: diskFree !== null ? t('prefs.diskFree', { free: diskFree.toFixed(1) }) : '',
            })}
          </p>
        )}
        <IntentField
          label={t('prefs.warmTtl')}
          intent={t('prefs.warmIntent')}
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
          {t('prefs.applyEngine')}
        </button>
        <button type="button" disabled={engineBusy} onClick={() => void onFlush(false)}>
          {t('prefs.flush')}
        </button>
        <button type="button" disabled={engineBusy} onClick={() => void onFlush(true)}>
          {t('prefs.flushClear')}
        </button>
      </div>
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        {t('prefs.residents', {
          models: residents.length > 0 ? residents.join(', ') : t('prefs.noneResident'),
        })}
      </p>

      <CompanionCard />

      <DataResetCard />

      <h3>{t('prefs.privacy')}</h3>
      <p className="muted">
        {t('prefs.privacyText')}
      </p>

      {status && (
        <p className="muted" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  )
}
