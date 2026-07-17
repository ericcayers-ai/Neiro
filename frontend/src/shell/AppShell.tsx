import { useEffect, useRef, useState, type ReactNode } from 'react'
import { listSessions, openSession, saveSession } from '../api/client'
import type { ModuleId } from '../api/types'
import { CommandPalette } from '../components/CommandPalette'
import { JobTray } from '../components/JobTray'
import {
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  MODULE_ICONS,
} from '../icons'
import { useSession } from '../state/session'
import {
  buildSessionGraphConfig,
  parseSessionGraphConfig,
  restoreMidiNoteEdits,
  writeCorrectionsDraft,
  writeMidiMode,
  restoreStudioTracks,
} from '../state/sessionGraph'
import { useDawBridge } from '../hooks/useDawBridge'
import { fmtTime } from '../constants/options'
import './shell.css'

const MODULES: { id: ModuleId; label: string; hint: string; key?: string }[] = [
  { id: 'import', label: 'Import', hint: 'Open a file or fetch a URL', key: '1' },
  { id: 'analysis', label: 'Analysis', hint: 'Report for the current file', key: '2' },
  { id: 'studio', label: 'Studio', hint: 'Timeline, edits, and mix/export', key: '3' },
  { id: 'separate', label: 'Separate', hint: 'Stem separation jobs', key: '4' },
  { id: 'restore', label: 'Restore', hint: 'Enhancement and repair chains', key: '5' },
  { id: 'midi', label: 'MIDI', hint: 'Transcribe, roll, score, edit, practice', key: '6' },
  { id: 'preferences', label: 'Prefs', hint: 'Theme, density, models, compute', key: '9' },
  { id: 'about', label: 'About', hint: 'Version, privacy, Studio shortcuts' },
]

const RAIL_KEY = 'neiro.shell.railCollapsed'
const MENU_KEY = 'neiro.shell.sessionMenu'

function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    module,
    setModule,
    file,
    jobRunning,
    jobLabel,
    requestCancel,
    clearSession,
    engineStatus,
    stemPacks,
    setStemPacks,
    analysisCorrections,
    setAnalysisCorrections,
    transcribeResult,
    setTranscribeResult,
    setMidiModeFocus,
  } = useSession()

  const { dawConnected, status: dawStatus } = useDawBridge()
  const [sessionMsg, setSessionMsg] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionDialog, setSessionDialog] = useState<null | 'save' | 'open'>(null)
  const [sessionName, setSessionName] = useState('')
  const [sessionList, setSessionList] = useState<{ name: string }[]>([])
  const [sessionBusy, setSessionBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogInputRef = useRef<HTMLInputElement>(null)

  const recording = Boolean(dawStatus?.instances?.some((i) => i.recording))

  useEffect(() => {
    const root = document.documentElement
    root.dataset.rail = railCollapsed ? 'collapsed' : 'expanded'
    try {
      localStorage.setItem(RAIL_KEY, railCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [railCollapsed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setRailCollapsed((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!sessionDialog) return
    const t = window.setTimeout(() => dialogInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [sessionDialog])

  const flash = (msg: string) => {
    setSessionMsg(msg)
    window.setTimeout(() => setSessionMsg(''), 4500)
  }

  const openSaveDialog = () => {
    setMenuOpen(false)
    setSessionName(file?.name?.replace(/\.[^.]+$/, '') || 'untitled')
    setSessionDialog('save')
  }

  const openOpenDialog = async () => {
    setMenuOpen(false)
    setSessionBusy(true)
    try {
      const { sessions } = await listSessions()
      if (!sessions.length) {
        flash('No saved sessions on this machine yet.')
        return
      }
      setSessionList(sessions)
      setSessionName(sessions[0]?.name || '')
      setSessionDialog('open')
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setSessionBusy(false)
    }
  }

  const confirmSave = async () => {
    const name = sessionName.trim()
    if (!name) return
    setSessionBusy(true)
    try {
      const graph_config = buildSessionGraphConfig({
        module,
        stemPacks,
        analysisCorrections,
        transcribeResult,
      }) as Record<string, unknown>
      const res = await saveSession({
        name,
        file_id: file?.fileId,
        graph_config,
      })
      setSessionDialog(null)
      flash(`Saved session “${res.name}”`)
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setSessionBusy(false)
    }
  }

  const confirmOpen = async () => {
    const name = sessionName.trim()
    if (!name) return
    setSessionBusy(true)
    try {
      const res = await openSession(name)
      const cfg = parseSessionGraphConfig(res.session?.graph_config)
      if (cfg.module) setModule(cfg.module)
      if (cfg.stemPacks) setStemPacks(cfg.stemPacks)
      if (cfg.analysisCorrections) setAnalysisCorrections(cfg.analysisCorrections)
      if (cfg.analysisCorrectionsDraft) writeCorrectionsDraft(cfg.analysisCorrectionsDraft)
      if (cfg.midiMode) {
        writeMidiMode(cfg.midiMode)
        setMidiModeFocus(cfg.midiMode)
      }
      const notes = restoreMidiNoteEdits(cfg.midiNoteEdits)
      if (notes) setTranscribeResult(notes)
      if (cfg.studioTracks?.length) {
        restoreStudioTracks(cfg.studioTracks)
      }
      setSessionDialog(null)
      flash(
        `Opened “${name}” — packs/MIDI/Studio timeline/corrections restored; re-import audio if URLs expired.`,
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setSessionBusy(false)
    }
  }

  return (
    <div className={`shell${railCollapsed ? ' rail-collapsed' : ''}`}>
      <a className="skip-link" href="#module-content">
        Skip to content
      </a>

      {railCollapsed && (
        <button
          type="button"
          className="rail-edge-toggle"
          aria-label="Expand navigation"
          title="Expand navigation (Ctrl+B)"
          onClick={() => setRailCollapsed(false)}
        >
          <IconChevronRight size={18} />
        </button>
      )}

      <aside className="rail" aria-label="Modules">
        <div className="rail-brand">
          <div className="rail-brand-row">
            <div className="rail-logo" title="Neiro">
              Neiro
            </div>
            <button
              type="button"
              className="icon-btn ghost rail-toggle"
              aria-pressed={false}
              aria-label="Hide navigation"
              title="Hide navigation (Ctrl+B)"
              onClick={() => setRailCollapsed(true)}
            >
              <IconChevronLeft size={18} />
            </button>
          </div>
          <div className="rail-tagline">local audio worksuite</div>
        </div>

        <button
          type="button"
          className="rail-search"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (Ctrl+K)"
          aria-label="Open command palette"
        >
          <span className="rail-search-inner">
            <IconSearch size={16} />
            <span>Jump…</span>
          </span>
          <kbd className="rail-kbd">Ctrl+K</kbd>
        </button>

        <nav className="rail-nav">
          {MODULES.map((m) => {
            const ModIcon = MODULE_ICONS[m.id]
            return (
              <button
                key={m.id}
                type="button"
                className={`rail-item${module === m.id ? ' active' : ''}`}
                onClick={() => setModule(m.id)}
                aria-current={module === m.id ? 'page' : undefined}
                aria-label={m.label}
                title={m.key ? `${m.hint} (${m.key})` : m.hint}
              >
                <span className="rail-item-row">
                  <span className="rail-item-main">
                    <ModIcon className="rail-icon" size={20} />
                    <span className="rail-label">{m.label}</span>
                  </span>
                  {m.key && <span className="rail-key mono faint">{m.key}</span>}
                </span>
                {module === m.id && <span className="rail-hint">{m.hint}</span>}
              </button>
            )
          })}
        </nav>
        <footer className="rail-foot">
          Processing stays on this machine. Audio never leaves it.
        </footer>
      </aside>

      <div className="shell-main">
        <header className={`session-bar${module === 'studio' || module === 'midi' ? ' daw-chrome' : ''}`}>
          <div className="session-file">
            {file ? (
              <>
                <strong title={file.name}>{file.name}</strong>
                <span className="mono muted session-meta">
                  {fmtTime(file.report.duration_seconds)} · {file.report.sample_rate} Hz
                  {file.report.channels === 1 ? ' · mono' : ' · stereo'}
                  {(module === 'studio' || module === 'midi') && ' · transport in module'}
                </span>
              </>
            ) : (
              <button
                type="button"
                className="ghost session-empty-cta"
                onClick={() => setModule('import')}
              >
                No file — Import a track
              </button>
            )}
            {sessionMsg && (
              <span className="session-toast muted" role="status" aria-live="polite">
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
                DAW · {dawStatus?.instance_count || 0}
                {recording ? ' · rec' : ''}
              </span>
            )}
            {engineStatus === 'down' && (
              <span className="job-pill danger" role="status" aria-live="assertive">
                Engine down
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
            <div className="session-menu" ref={menuRef}>
              <button
                type="button"
                className="ghost"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls={MENU_KEY}
                disabled={jobRunning || sessionBusy}
                onClick={() => setMenuOpen((v) => !v)}
                title="Session actions"
              >
                Session ▾
              </button>
              {menuOpen && (
                <div className="session-menu-pop" id={MENU_KEY} role="menu">
                  <button type="button" role="menuitem" onClick={() => void openSaveDialog()}>
                    Save session…
                  </button>
                  <button type="button" role="menuitem" onClick={() => void openOpenDialog()}>
                    Open session…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      clearSession()
                      flash('Session cleared')
                    }}
                  >
                    New session
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="module-content">
          {children}
        </main>
      </div>
      <JobTray />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {sessionDialog && (
        <div
          className="palette-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !sessionBusy) setSessionDialog(null)
          }}
        >
          <div
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-dialog-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !sessionBusy) setSessionDialog(null)
            }}
          >
            <h2 id="session-dialog-title">
              {sessionDialog === 'save' ? 'Save session' : 'Open session'}
            </h2>
            <p className="lede">
              {sessionDialog === 'save'
                ? 'Portable session metadata on this machine.'
                : 'Restore graph config; re-import the source audio if needed.'}
            </p>
            {sessionDialog === 'open' ? (
              <label className="field">
                <span>Session</span>
                <select
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  disabled={sessionBusy}
                >
                  {sessionList.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>Name</span>
                <input
                  ref={dialogInputRef}
                  type="text"
                  value={sessionName}
                  disabled={sessionBusy}
                  onChange={(e) => setSessionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void confirmSave()
                    }
                  }}
                />
              </label>
            )}
            <div className="row" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="primary"
                disabled={sessionBusy || !sessionName.trim()}
                onClick={() => void (sessionDialog === 'save' ? confirmSave() : confirmOpen())}
              >
                {sessionDialog === 'save' ? 'Save' : 'Open'}
              </button>
              <button type="button" disabled={sessionBusy} onClick={() => setSessionDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
