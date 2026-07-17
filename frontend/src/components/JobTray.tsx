import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconDismiss,
  IconJobs,
} from '../icons'
import { useSession } from '../state/session'

const COLLAPSE_KEY = 'neiro.jobTray.collapsed'
const HEIGHT_KEY = 'neiro.jobTray.heightPx'

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
  const [heightPx, setHeightPx] = useState(() => {
    try {
      const n = Number(localStorage.getItem(HEIGHT_KEY))
      if (Number.isFinite(n) && n >= 140 && n <= 560) return n
    } catch {
      /* ignore */
    }
    return 280
  })
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

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
    try {
      localStorage.setItem(HEIGHT_KEY, String(heightPx))
    } catch {
      /* ignore */
    }
  }, [heightPx])

  useEffect(() => {
    if (runningCount > 0) setCollapsed(false)
  }, [runningCount])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const next = Math.min(560, Math.max(140, d.startH + (d.startY - e.clientY)))
      setHeightPx(next)
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  if (!visible.length) return null

  if (collapsed) {
    return (
      <aside className="job-tray collapsed" aria-label="Background jobs">
        <button
          type="button"
          className="job-tray-edge ghost icon-btn"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Show job tray"
          title="Show jobs"
        >
          <IconJobs size={18} />
          <IconChevronUp size={14} />
          {runningCount > 0 && (
            <span className="job-tray-badge mono">{runningCount}</span>
          )}
        </button>
      </aside>
    )
  }

  return (
    <aside className="job-tray" aria-label="Background jobs" style={{ height: heightPx, maxHeight: 'none' }}>
      <div
        className="job-tray-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize job tray"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault()
          dragRef.current = { startY: e.clientY, startH: heightPx }
        }}
      />
      <div className="job-tray-head">
        <strong className="job-tray-title">
          <IconJobs size={16} />
          Jobs
        </strong>
        <div className="job-tray-head-actions">
          <span className="muted mono">{runningCount} active</span>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setCollapsed(true)}
            aria-expanded
            aria-label="Hide job tray"
            title="Hide jobs"
          >
            <IconChevronDown size={16} />
          </button>
        </div>
      </div>
      <ul className="job-tray-list">
        {visible.map((j) => (
          <li key={j.id} className="job-tray-item">
            <div className="job-tray-row">
              <button
                type="button"
                className="job-tray-jump"
                onClick={() => {
                  setModule(j.module)
                  setExpanded((e) => (e === j.id ? null : j.id))
                }}
              >
                <span className="job-tray-label">{j.label}</span>
                <span className="job-tray-meta muted mono">
                  {j.status}
                  {j.fraction != null ? ` · ${Math.round(j.fraction * 100)}%` : ''}
                </span>
              </button>
              <div className="job-tray-actions">
                {j.status === 'running' && (
                  <button type="button" className="ghost" onClick={() => void cancelSessionJob(j.id)}>
                    Cancel
                  </button>
                )}
                {j.status !== 'running' && (
                  <button
                    type="button"
                    className="ghost icon-btn"
                    aria-label="Dismiss"
                    onClick={() => dismissJob(j.id)}
                  >
                    <IconDismiss size={14} />
                  </button>
                )}
              </div>
            </div>
            {j.fraction != null && j.status === 'running' && (
              <div className="job-bar thin" aria-hidden>
                <div className="job-bar-fill" style={{ width: `${Math.round(j.fraction * 100)}%` }} />
              </div>
            )}
            {expanded === j.id && j.progress.length > 0 && (
              <pre className="job-tray-log">{j.progress.slice(-40).join('\n')}</pre>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
