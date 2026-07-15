import { useCallback, useRef, useState } from 'react'
import { ingestUrl, uploadFile } from '../api/client'
import { useSession } from '../state/session'
import { IntentField } from '../components/IntentField'
import './modules.css'

export function ImportModule() {
  const { setFile, setModule, setSeparateResult, setTranscribeResult, setEnhanceResult } =
    useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('Drop an audio file, browse, or paste a URL')
  const [over, setOver] = useState(false)

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
    setBusy(true)
    setMsg(`Reading ${file.name} …`)
    try {
      const data = await uploadFile(file)
      await accept(data)
    } catch (err) {
      setMsg(`Couldn't read that file: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const onFetch = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setBusy(true)
    setMsg('Fetching URL …')
    try {
      const data = await ingestUrl(trimmed)
      await accept(data)
    } catch (err) {
      setMsg(`Couldn't fetch URL: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="module-panel">
      <h2>Import</h2>
      <p className="lede">
        Open a local file or fetch audio from a URL. All three paths are equal — drag-and-drop is
        never required.
      </p>

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
        <div className="intent" style={{ marginTop: 8 }}>
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

      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          title="Open a file from disk"
        >
          Browse
        </button>
        <span className="intent" style={{ alignSelf: 'center', margin: 0 }}>
          Same result as dropping a file — available without a pointing device that supports drag.
        </span>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <IntentField
          label="URL"
          intent="Fetch with yt-dlp when installed. Cached under the local Neiro home directory."
          htmlFor="import-url"
        >
          <div className="row">
            <input
              id="import-url"
              type="url"
              value={url}
              disabled={busy}
              placeholder="https://…"
              style={{ flex: 1, minWidth: 200 }}
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

      <p className={`status-line${msg.startsWith("Couldn't") ? ' error-text' : ' muted'}`}>{msg}</p>
    </div>
  )
}
