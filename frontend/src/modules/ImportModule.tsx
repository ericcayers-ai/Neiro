import { useCallback, useRef, useState } from 'react'
import { ingestUrl, uploadFile } from '../api/client'
import { JobProgress } from '../components/JobProgress'
import { IntentField } from '../components/IntentField'
import { ModuleHeader } from '../components/ModuleHeader'
import { useSession } from '../state/session'
import './modules.css'

export function ImportModule() {
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
      setMsg(`${list.length} files in queue — open Separate → “Separate queue → add packs”.`)
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
        report('done', 1, `${data.name} loaded`)
      },
    })
    if (!result.ok) {
      setMsg(`Couldn't fetch URL: ${result.error}`)
    }
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title="Import"
        lede="Open local files (multi-select for mashup packs) or fetch a URL."
        actions={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title="Open files from disk"
          >
            Browse
          </button>
        }
      />

      <div
        className={`dropzone${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Choose audio files"
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
        <div className="drop-title">{busy ? 'Working…' : 'Drop audio here'}</div>
        <div className="intent" style={{ marginTop: '0.55rem' }}>
          Multi-select for batch Separate → mashup packs. WAV/FLAC/OGG; MP3/M4A via ffmpeg.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void onFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {importQueue.length > 0 && (
        <div className="option-detail" style={{ marginTop: '1rem' }} role="status">
          <div className="option-detail-title">Import queue ({importQueue.length})</div>
          <ul className="sep-stem-badges">
            {importQueue.map((f) => (
              <li key={f.fileId}>
                <button
                  type="button"
                  className="stem-badge"
                  title="Set as active file"
                  onClick={() => {
                    setFile(f)
                    setMsg(`${f.name} active`)
                  }}
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removeFromImportQueue(f.fileId)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
            <button type="button" onClick={() => setModule('separate')}>
              Go to Separate
            </button>
            <button type="button" className="ghost" onClick={() => clearImportQueue()}>
              Clear queue
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: '1.25rem' }}>
        <IntentField
          label="URL"
          intent="Needs yt-dlp. Cached under the local Neiro home directory."
          htmlFor="import-url"
        >
          <div className="row">
            <input
              id="import-url"
              type="url"
              value={url}
              disabled={busy}
              placeholder="https://…"
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
              Fetch URL
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
