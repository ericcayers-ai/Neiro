import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../state/session'

const COLLAPSE_KEY = 'neiro.jobTray.collapsed'

export function JobTray() {
  const { jobs, setModule, cancelSessionJob, dismissJob } = useSession()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  const visible = useMemo(() => {
    const running = jobs.filter((j) => j.status === 'running')
    const recent = jobs.filter((j) => j.status !== 'running').slice(0, 4)
    return [...running, ...recent]
  }, [jobs])

  const runningCount = visible.filter((j) => j.status === 'running').length

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    if (runningCount > 0) setCollapsed(false)
  }, [runningCount])

  if (!visible.length) return null

  return (
    <aside
      className={`job-tray${collapsed ? ' collapsed' : ''}`}
      aria-label="Background jobs"
    >
      <div className="job-tray-head">
        <strong>Jobs</strong>
        <div className="job-tray-head-actions">
          <span className="muted mono">{runningCount} active</span>
          <button
            type="button"
            className="ghost"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand job tray' : 'Collapse job tray'}
          >
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <ul className="job-tray-list">
          {visible.map((job) => {
            const open = expanded === job.id
            const pct =
              typeof job.fraction === 'number' ? Math.round(job.fraction * 100) : null
            const fillScale =
              job.fraction != null
                ? Math.max(0, Math.min(1, job.fraction))
                : job.status === 'done'
                  ? 1
                  : 0
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
                  className={`job-bar thin${
                    job.fraction == null && job.status === 'running' ? ' indeterminate' : ''
                  }`}
                >
                  <div
                    className="job-bar-fill"
                    style={
                      job.fraction != null || job.status === 'done'
                        ? { transform: `scaleX(${fillScale})` }
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
      )}
    </aside>
  )
}
