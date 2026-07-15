import { useEffect } from 'react'
import { startEnhance } from '../api/client'
import { useJobPoller, useLocalPref } from '../api/hooks'
import type { EnhanceResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { RESTORE_CHAINS } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

export function RestoreModule() {
  const {
    file,
    enhanceResult,
    setEnhanceResult,
    openInStudio,
    setJobRunning,
    setJobLabel,
    registerCancel,
  } = useSession()
  const [chain, setChain] = useLocalPref('neiro.restore.chain', 'auto')
  const job = useJobPoller()
  const selected = RESTORE_CHAINS.find((c) => c.value === chain) || RESTORE_CHAINS[0]

  useEffect(() => {
    setJobRunning(job.running)
    setJobLabel(job.running ? `Restore · ${chain}` : null)
    registerCancel(job.running ? () => void job.cancel() : null)
    return () => {
      registerCancel(null)
      setJobRunning(false)
      setJobLabel(null)
    }
  }, [job.running, job.cancel, chain, registerCancel, setJobRunning, setJobLabel])

  const run = async () => {
    if (!file) return
    const done = await job.start('enhance', () => startEnhance(file.fileId, chain))
    if (done?.status === 'done' && done.result) {
      setEnhanceResult(done.result as EnhanceResult)
    }
  }

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Restore</h2>
        <div className="gate muted">Import a file first.</div>
      </div>
    )
  }

  const result = enhanceResult

  return (
    <div className="module-panel">
      <h2>Restore</h2>
      <p className="lede">
        Enhancement chain for <strong>{file.name}</strong>. Edits write a new artifact; the source
        upload is untouched.
      </p>

      <div className="row">
        <IntentField label="Chain" intent={selected.intent} htmlFor="restore-chain">
          <select
            id="restore-chain"
            value={chain}
            disabled={job.running}
            onChange={(e) => setChain(e.target.value)}
          >
            {RESTORE_CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </IntentField>
        <button
          type="button"
          className="primary"
          disabled={job.running}
          onClick={() => void run()}
          title="Start restoration"
        >
          Restore
        </button>
      </div>

      <JobProgress status={job.status} error={job.error} onCancel={() => void job.cancel()} />

      {result && (
        <div style={{ marginTop: 20 }}>
          {result.file_url ? (
            <>
              <audio controls src={result.file_url} style={{ width: '100%' }} />
              <div className="meta-block">
                Applied: {(result.chain || []).join(' → ') || 'none'}
                <br />
                {(result.notes || []).join(' · ')}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <a
                  className="primary"
                  href={result.file_url}
                  download
                  style={{
                    padding: '7px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                  }}
                >
                  Download
                </a>
                {result.file_id && (
                  <button
                    type="button"
                    onClick={() =>
                      openInStudio(result.file_id!, result.file_url!, `${file.name}.restored`)
                    }
                    title="Load the restored audio in Studio"
                  >
                    Open in Studio
                  </button>
                )}
                <span className="intent" style={{ margin: 0, alignSelf: 'center' }}>
                  Opens the restored artifact in Studio without changing the original upload.
                </span>
              </div>
            </>
          ) : (
            <div className="meta-block">{(result.notes || ['Nothing to repair.']).join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
