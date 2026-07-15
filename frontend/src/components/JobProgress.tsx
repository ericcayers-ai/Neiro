import { useState } from 'react'
import type { JobStatus } from '../api/types'

export function JobProgress({
  status,
  error,
  onCancel,
}: {
  status: JobStatus | null
  error: string | null
  onCancel?: () => void
}) {
  const [open, setOpen] = useState(true)
  if (!status && !error) return null
  const lines = status?.progress?.length ? status.progress : ['working…']
  const latest = lines[lines.length - 1]

  return (
    <div className="job-progress" role="status" aria-live="polite">
      <div className="job-progress-head">
        <div>
          <strong>{status?.status === 'running' ? 'Working' : status?.status || 'Error'}</strong>
          <div className="mono muted" style={{ marginTop: 4 }}>
            {error || latest}
          </div>
        </div>
        {status?.status === 'running' && onCancel && (
          <button type="button" onClick={onCancel} title="Cancel this job">
            Cancel
          </button>
        )}
      </div>
      <button
        type="button"
        className="details-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <pre className="job-details mono" aria-label="Job stage log">
          {lines.join('\n')}
          {error ? `\nFailed: ${error}` : ''}
        </pre>
      )}
    </div>
  )
}
