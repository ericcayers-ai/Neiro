import { useMemo, useState } from 'react'
import { useSession } from '../state/session'

export function JobTray() {
  const { jobs, setModule, cancelSessionJob, dismissJob } = useSession()
  const [expanded, setExpanded] = useState<string | null>(null)
  const visible = useMemo(() => {
    const running = jobs.filter((j) => j.status === 'running')
    const recent = jobs.filter((j) => j.status !== 'running').slice(0, 4)
    return [...running, ...recent]
  }, [jobs])

  if (!visible.length) return null

  return (
    <aside className="job-tray" aria-label="Background jobs">
      <div className="job-tray-head">
        <strong>Jobs</strong>
        <span className="muted mono">{visible.filter((j) => j.status === 'running').length} active</span>
      </div>
      <ul className="job-tray-list">
        {visible.map((job) => {
          const open = expanded === job.id
          const pct =
            typeof job.fraction === 'number' ? Math.round(job.fraction * 100) : null
          return (
            <li key={job.id} className={`job-tray-item status-${job.status}`}>
              <div className="job-tray-row">
                <button
                  type="button"
                  className="job-tray-jump"
                  onClick={() => setModule(job.module)}
                  title={`Open ${job.module}`}
                >
                  <span className="job-tray-label">{job.label}</span>
                  <span className="mono muted">
                    {job.status}
                    {job.stage ? ` · ${job.stage}` : ''}
                    {pct != null ? ` · ${pct}%` : ''}
                  </span>
                </button>
                <div className="job-tray-actions">
                  {job.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => void cancelSessionJob(job.id)}
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : job.id)}
                    aria-expanded={open}
                    title="Toggle logs"
                  >
                    {open ? 'Hide' : 'Log'}
                  </button>
                  {job.status !== 'running' && (
                    <button type="button" onClick={() => dismissJob(job.id)} title="Dismiss">
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div
                className={`job-bar thin${job.fraction == null && job.status === 'running' ? ' indeterminate' : ''}`}
              >
                <div
                  className="job-bar-fill"
                  style={
                    job.fraction != null
                      ? { width: `${Math.round(job.fraction * 100)}%` }
                      : job.status === 'done'
                        ? { width: '100%' }
                        : undefined
                  }
                />
              </div>
              {open && (
                <pre className="job-tray-log mono">
                  {(job.progress.length ? job.progress : [job.stage || job.status]).join('\n')}
                  {job.error ? `\n${job.error}` : ''}
                </pre>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
