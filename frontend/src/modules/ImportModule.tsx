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
  } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('Drop an audio file, browse, or paste a URL')
  const [over, setOver] = useState(false)
  const job = jobForKind('import')
  const busy = job?.status === 'running'

  const accept = useCallback(
    async (data: Awaited<ReturnType<typeof uploadFile>>) => {
      setSeparateResult(null)
      setTranscribeResult(null)
      setEnhanceResult(null)
      setFile({
        fileId: data.file_id,
        name: data.name,
        audioUrl: data.audio_url,
        report: data.report,
      })
      setMsg(`${data.name} loaded`)
      setModule('analysis')
    },
    [setFile, setModule, setSeparateResult, setTranscribeResult, setEnhanceResult],
  )

  const onFile = async (file: File) => {
    setMsg(`Reading ${file.name} …`)
    const result = await startLocalJob({
      kind: 'import',
      label: `Import · ${file.name}`,
      module: 'import',
      run: async (report) => {
        report('upload', 0.15, `Uploading ${file.name}`)
        const data = await uploadFile(file)
        report('decode', 0.55, 'Decode complete')
        report('analyze', 0.9, 'Analysis ready')
        await accept(data)
        report('done', 1, `${data.name} loaded`)
      },
    })
    if (!result.ok) {
      setMsg(`Couldn't read that file: ${result.error}`)
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
        lede="Open a local file or fetch a URL. Drop, Browse, and Fetch all do the same job."
        actions={
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title="Open a file from disk"
          >
            Browse
          </button>
        }
      />

      <div
        className={`dropzone${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Choose an audio file"
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
          const f = e.dataTransfer.files[0]
          if (f) void onFile(f)
        }}
      >
        <div className="drop-title">{busy ? 'Working…' : 'Drop audio here'}</div>
        <div className="intent" style={{ marginTop: '0.55rem' }}>
          WAV, FLAC, OGG directly; MP3/M4A/video via ffmpeg when available.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />
      </div>

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
