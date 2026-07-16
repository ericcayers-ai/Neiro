import { useState } from 'react'
import type { JobStatus } from '../api/types'
import type { SessionJob } from '../state/session'

function linesFrom(status: JobStatus | SessionJob | null): string[] {
  if (!status) return []
  if ('progress' in status && status.progress?.length) return status.progress
  return ['working…']
}

function fractionOf(status: JobStatus | SessionJob | null): number | null {
  if (!status) return null
  const f = status.fraction
  if (typeof f === 'number' && Number.isFinite(f)) return Math.max(0, Math.min(1, f))
  return null
}

export function JobProgress({
  status,
  error,
  onCancel,
}: {
  status: JobStatus | SessionJob | null
  error?: string | null
  onCancel?: () => void
}) {
  const [logsOpen, setLogsOpen] = useState(false)
  if (!status && !error) return null
  const lines = linesFrom(status)
  const latest = lines[lines.length - 1]
  const fraction = fractionOf(status)
  const running = status?.status === 'running'
  const err = error ?? (status && 'error' in status ? status.error : null)
  const stage =
    status && 'stage' in status && status.stage
      ? status.stage
      : running
        ? 'Working'
        : status?.status || 'Error'
  const eta =
    status && 'eta_s' in status && typeof status.eta_s === 'number'
      ? ` · ~${Math.max(1, Math.round(status.eta_s))}s left`
      : ''

  return (
    <div className="job-progress" role="status" aria-live="polite">
      <div className="job-progress-head">
        <div>
          <strong>{running ? 'Working' : status?.status || 'Error'}</strong>
          <div className="mono muted" style={{ marginTop: '0.3rem' }}>
            {err || `${stage}${eta}`}
            {!err && latest && latest !== stage ? ` — ${latest}` : ''}
          </div>
        </div>
        {running && onCancel && (
          <button type="button" onClick={onCancel} title="Cancel this job">
            Cancel
          </button>
        )}
      </div>
      <div
        className={`job-bar${fraction == null && running ? ' indeterminate' : ''}`}
        aria-hidden
      >
        <div
          className="job-bar-fill"
          style={
            fraction != null
              ? { width: `${Math.round(fraction * 100)}%` }
              : running
                ? undefined
                : { width: status?.status === 'done' ? '100%' : '0%' }
          }
        />
      </div>
      {fraction != null && (
        <div className="mono muted job-bar-pct">{Math.round(fraction * 100)}%</div>
      )}
      <button
        type="button"
        className="details-toggle"
        onClick={() => setLogsOpen((v) => !v)}
        aria-expanded={logsOpen}
      >
        {logsOpen ? 'Hide stage log' : 'Show stage log'}
      </button>
      {logsOpen && (
        <pre className="job-details mono" aria-label="Job stage log">
          {lines.join('\n')}
          {err ? `\nFailed: ${err}` : ''}
        </pre>
      )}
    </div>
  )
}
