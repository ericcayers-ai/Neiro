import { useState, type ReactNode } from 'react'
import { listSessions, openSession, saveSession } from '../api/client'
import type { ModuleId } from '../api/types'
import { useSession } from '../state/session'
import { useDawBridge } from '../hooks/useDawBridge'
import { fmtTime } from '../constants/options'
import './shell.css'

const MODULES: { id: ModuleId; label: string; hint: string; key?: string; advanced?: boolean }[] = [
  { id: 'import', label: 'Import', hint: 'Open a file or fetch a URL', key: '1' },
  { id: 'analysis', label: 'Analysis', hint: 'Read-only report for the current file', key: '2' },
  { id: 'studio', label: 'Studio', hint: 'Waveform editor — view and edit audio', key: '3' },
  { id: 'separate', label: 'Separate', hint: 'Stem separation jobs', key: '4' },
  { id: 'restore', label: 'Restore', hint: 'Enhancement and repair chains', key: '5' },
  { id: 'transcribe', label: 'Transcribe', hint: 'MIDI / piano roll', key: '6' },
  { id: 'mixer', label: 'Mixer', hint: 'Separation results and stem balance', key: '7' },
  { id: 'learn', label: 'Learn', hint: 'Practice mode with loop and wait', key: '8', advanced: true },
  { id: 'preferences', label: 'Prefs', hint: 'Models, compute, themes, shortcuts', key: '9' },
  { id: 'about', label: 'About', hint: 'Version, privacy, and local-only notes' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const {
    module,
    setModule,
    file,
    jobRunning,
    jobLabel,
    requestCancel,
    clearSession,
    workspaceMode,
    setWorkspaceMode,
    engineStatus,
  } = useSession()

  const { dawConnected, status: dawStatus } = useDawBridge()
  const [sessionMsg, setSessionMsg] = useState('')

  // DAW injectors unlock the full rail (all modes) even in Simple workspace.
  const visible = MODULES.filter((m) => workspaceMode === 'advanced' || !m.advanced || dawConnected)

  const recording = Boolean(dawStatus?.instances?.some((i) => i.recording))

  const onSave = async () => {
    const name = window.prompt('Session name', file?.name?.replace(/\.[^.]+$/, '') || 'untitled')
    if (!name) return
    try {
      const res = await saveSession({
        name,
        file_id: file?.fileId,
        graph_config: { module, workspaceMode },
      })
      setSessionMsg(`Saved session “${res.name}”`)
    } catch (err) {
      setSessionMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const onOpen = async () => {
    try {
      const { sessions } = await listSessions()
      if (!sessions.length) {
        setSessionMsg('No saved sessions on this machine yet.')
        return
      }
      const name = window.prompt(
        `Open session:\n${sessions.map((s) => s.name).join('\n')}`,
        sessions[0]?.name,
      )
      if (!name) return
      const res = await openSession(name)
      const cfg = (res.session?.graph_config || {}) as { module?: ModuleId; workspaceMode?: string }
      if (cfg.workspaceMode === 'advanced' || cfg.workspaceMode === 'simple') {
        setWorkspaceMode(cfg.workspaceMode)
      }
      if (cfg.module) setModule(cfg.module)
      setSessionMsg(`Opened session “${name}” (metadata restored; re-import source if needed).`)
    } catch (err) {
      setSessionMsg(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#module-content">
        Skip to content
      </a>
      <aside className="rail" aria-label="Modules">
        <div className="rail-brand">
          <div className="rail-logo">Neiro</div>
          <div className="rail-tagline">local audio worksuite</div>
        </div>
        <div className="mode-toggle" role="group" aria-label="Workspace mode">
          <button
            type="button"
            className={workspaceMode === 'simple' ? 'active' : ''}
            onClick={() => setWorkspaceMode('simple')}
            title="Simple mode — planner decisions hidden behind defaults"
          >
            Simple
          </button>
          <button
            type="button"
            className={workspaceMode === 'advanced' ? 'active' : ''}
            onClick={() => setWorkspaceMode('advanced')}
            title="Advanced mode — inspect and override the planned graph"
          >
            Advanced
          </button>
        </div>
        <nav className="rail-nav">
          {visible.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`rail-item${module === m.id ? ' active' : ''}`}
              onClick={() => setModule(m.id)}
              aria-current={module === m.id ? 'page' : undefined}
              title={m.hint}
            >
              <span className="rail-label">{m.label}</span>
              <span className="intent">{m.hint}</span>
            </button>
          ))}
        </nav>
        <footer className="rail-foot">
          Processing stays on this machine. Audio never leaves it.
        </footer>
      </aside>

      <div className="shell-main">
        <header className="session-bar">
          <div className="session-file">
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span className="mono muted">
                  {fmtTime(file.report.duration_seconds)} · {file.report.sample_rate} Hz
                  {file.report.channels === 1 ? ' · mono' : ' · stereo'}
                </span>
              </>
            ) : (
              <span className="muted">No file loaded — Import a track or capture from DAW</span>
            )}
            {sessionMsg && (
              <span className="muted" role="status" aria-live="polite">
                {sessionMsg}
              </span>
            )}
          </div>
          <div className="session-actions">
            {dawConnected && (
              <span
                className={`job-pill${recording ? ' recording' : ''}`}
                role="status"
                aria-live="polite"
                title={dawStatus?.contract}
              >
                DAW · {dawStatus?.instance_count || 0} injector
                {(dawStatus?.instance_count || 0) === 1 ? '' : 's'}
                {recording ? ' · recording' : ''}
              </span>
            )}
            {engineStatus === 'down' && (
              <span className="job-pill danger" role="status" aria-live="assertive">
                Engine unreachable
              </span>
            )}
            {jobRunning && (
              <span className="job-pill" role="status" aria-live="polite">
                {jobLabel || 'Working'}
              </span>
            )}
            {jobRunning && (
              <button type="button" onClick={() => requestCancel()} title="Stop the running job">
                Cancel
              </button>
            )}
            <button type="button" onClick={() => void onSave()} disabled={jobRunning} title="Save portable session">
              Save
            </button>
            <button type="button" onClick={() => void onOpen()} disabled={jobRunning} title="Open portable session">
              Open
            </button>
            <button
              type="button"
              onClick={() => clearSession()}
              title="Clear file and all job results; start a new session"
              disabled={jobRunning}
            >
              New session
            </button>
          </div>
        </header>
        <main className="content" id="module-content">
          {children}
        </main>
      </div>
    </div>
  )
}
