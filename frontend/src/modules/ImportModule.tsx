import { useCallback, useRef, useState } from 'react'
import { ingestUrl, uploadFile } from '../api/client'
import { JobProgress } from '../components/JobProgress'
import { IntentField } from '../components/IntentField'
import { ModuleHeader } from '../components/ModuleHeader'
import { useSession } from '../state/session'
import { usePlural, useT } from '../i18n'
import './modules.css'

export function ImportModule() {
  const t = useT()
  const plural = usePlural()
  const {
    setFile,
    setModule,
    setSeparateResult,
    setTranscribeResult,
    setEnhanceResult,
    startLocalJob,
    jobForKind,
    cancelSessionJob,
    importQueue,
    addToImportQueue,
    removeFromImportQueue,
    clearImportQueue,
  } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('Drop audio files, browse (multi-select), or paste a URL')
  const [over, setOver] = useState(false)
  const job = jobForKind('import')
  const busy = job?.status === 'running'

  const accept = useCallback(
    async (
      data: Awaited<ReturnType<typeof uploadFile>>,
      opts?: { stayOnImport?: boolean; queueOnly?: boolean },
    ) => {
      const entry = {
        fileId: data.file_id,
        name: data.name,
        audioUrl: data.audio_url,
        report: data.report,
      }
      addToImportQueue(entry)
      if (opts?.queueOnly) {
        setMsg(`${data.name} added to queue (${importQueue.length + 1} files)`)
        return
      }
      setSeparateResult(null)
      setTranscribeResult(null)
      setEnhanceResult(null)
      setFile(entry)
      setMsg(`${data.name} loaded`)
      if (!opts?.stayOnImport) setModule('analysis')
    },
    [
      addToImportQueue,
      importQueue.length,
      setFile,
      setModule,
      setSeparateResult,
      setTranscribeResult,
      setEnhanceResult,
    ],
  )

  const onFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(Boolean)
    if (!list.length) return
    const multi = list.length > 1
    setMsg(multi ? `Importing ${list.length} files…` : `Reading ${list[0].name} …`)
    const result = await startLocalJob({
      kind: 'import',
      label: multi ? `Import · ${list.length} files` : `Import · ${list[0].name}`,
      module: 'import',
      run: async (report) => {
        for (let i = 0; i < list.length; i++) {
          const file = list[i]
          const fracBase = i / list.length
          report('upload', fracBase + 0.1 / list.length, `Uploading ${file.name}`)
          const data = await uploadFile(file)
          report('decode', fracBase + 0.5 / list.length, `Decoded ${file.name}`)
          await accept(data, {
            stayOnImport: multi,
            queueOnly: multi && i < list.length - 1,
          })
        }
        report('done', 1, multi ? `${list.length} files queued` : `${list[0].name} loaded`)
      },
    })
    if (!result.ok) {
      setMsg(`Couldn't read that file: ${result.error}`)
    } else if (multi) {
      setMsg('Files queued — open Separate → “Separate queue → add packs”.')
    }
  }

  const onFetch = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setMsg('Fetching URL …')
    const result = await startLocalJob({
      kind: 'import',
      label: 'Import · URL',
      module: 'import',
      run: async (report) => {
        report('fetch', 0.2, 'Fetching URL')
        const data = await ingestUrl(trimmed)
        report('decode', 0.6, 'Decode complete')
        report('analyze', 0.9, 'Analysis ready')
        await accept(data)
        report('done', 1, t('import.loaded', { name: data.name }))
      },
    })
    if (!result.ok) {
      setMsg(t('import.urlFailed', { error: result.error }))
    }
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title={t('import.title')}
        lede={t('import.lede')}
        actions={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title={t('import.browseTitle')}
          >
            {t('import.browse')}
          </button>
        }
      />

      <div
        className={`dropzone${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files?.length) void onFiles(e.dataTransfer.files)
        }}
      >
        <div className="drop-title">{busy ? t('import.working') : t('import.drop')}</div>
        <div className="intent" style={{ marginTop: '0.55rem' }}>
          {t('import.dropHint')}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        multiple
        aria-label={t('import.chooseAria')}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) void onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {importQueue.length > 0 && (
        <div className="option-detail" style={{ marginTop: '1rem' }} role="status">
          <div className="option-detail-title">{plural('import.queue', importQueue.length)}</div>
          <ul className="sep-stem-badges">
            {importQueue.map((f) => (
              <li key={f.fileId}>
                <button
                  type="button"
                  className="stem-badge"
                  title={t('import.setActive')}
                  onClick={() => {
                    setFile(f)
                    setMsg(t('import.active', { name: f.name }))
                  }}
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  className="ghost"
                  aria-label={t('import.remove', { name: f.name })}
                  onClick={() => removeFromImportQueue(f.fileId)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
            <button type="button" onClick={() => setModule('separate')}>
              {t('import.goSeparate')}
            </button>
            <button type="button" className="ghost" onClick={() => clearImportQueue()}>
              {t('import.clearQueue')}
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: '1.25rem' }}>
        <IntentField
          label={t('import.urlLabel')}
          intent={t('import.urlIntent')}
          htmlFor="import-url"
        >
          <div className="row">
            <input
              id="import-url"
              type="url"
              value={url}
              disabled={busy}
              placeholder={t('import.urlPlaceholder')}
              style={{ flex: 1, minWidth: '12rem' }}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void onFetch()
                }
              }}
            />
            <button type="button" disabled={busy || !url.trim()} onClick={() => void onFetch()}>
              {t('import.fetch')}
            </button>
          </div>
        </IntentField>
      </div>

      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />

      <p
        className={`status-line${
          msg.startsWith("Couldn't") || job?.status === 'error' ? ' error-text' : ' muted'
        }`}
      >
        {job?.status === 'error' && job.error ? job.error : msg}
      </p>
    </div>
  )
}
