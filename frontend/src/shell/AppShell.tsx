import { useEffect, useRef, useState, type ReactNode } from 'react'
import { listLibrarySongs, listSessions, openSession, saveSession } from '../api/client'
import type { LibrarySong, ModuleId } from '../api/types'
import { CommandPalette } from '../components/CommandPalette'
import { JobTray } from '../components/JobTray'
import {
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  MODULE_ICONS,
} from '../icons'
import { useSession } from '../state/session'
import { useT } from '../i18n'
import { mostRecentSong } from '../library/recent'
import {
  buildSessionGraphConfig,
  parseSessionGraphConfig,
  restoreMidiNoteEdits,
  writeCorrectionsDraft,
  writeMidiMode,
  restoreStudioTracks,
} from '../state/sessionGraph'
import { useDawBridge } from '../hooks/useDawBridge'
import { useAppearance } from '../hooks/useAppearance'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { fmtTime } from '../constants/options'
import './shell.css'

const MODULES: { id: ModuleId; labelKey: string; hintKey: string; key?: string }[] = [
  { id: 'import', labelKey: 'nav.import', hintKey: 'nav.import.hint', key: '1' },
  { id: 'analysis', labelKey: 'nav.analysis', hintKey: 'nav.analysis.hint', key: '2' },
  { id: 'studio', labelKey: 'nav.studio', hintKey: 'nav.studio.hint', key: '3' },
  { id: 'separate', labelKey: 'nav.separate', hintKey: 'nav.separate.hint', key: '4' },
  { id: 'restore', labelKey: 'nav.restore', hintKey: 'nav.restore.hint', key: '5' },
  { id: 'midi', labelKey: 'nav.midi', hintKey: 'nav.midi.hint', key: '6' },
  { id: 'library', labelKey: 'nav.library', hintKey: 'nav.library.hint', key: '0' },
  { id: 'preferences', labelKey: 'nav.preferences', hintKey: 'nav.preferences.hint', key: '9' },
  { id: 'about', labelKey: 'nav.about', hintKey: 'nav.about.hint' },
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
  useAppearance()
  const {
    module,
    setModule,
    file,
    jobRunning,
    jobLabel,
    requestCancel,
    clearSession,
    resumeSong,
    requestPracticeFocus,
    engineStatus,
    stemPacks,
    setStemPacks,
    analysisCorrections,
    setAnalysisCorrections,
    transcribeResult,
    setTranscribeResult,
    setMidiModeFocus,
  } = useSession()
  const t = useT()

  const { dawConnected, status: dawStatus } = useDawBridge()
  const [sessionMsg, setSessionMsg] = useState('')
  const [recentSong, setRecentSong] = useState<LibrarySong | null>(null)
  const lastFileIdRef = useRef<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionDialog, setSessionDialog] = useState<null | 'save' | 'open'>(null)
  const sessionDialogRef = useRef<HTMLDivElement>(null)
  const sessionButtonRef = useRef<HTMLButtonElement>(null)
  const railSearchRef = useRef<HTMLButtonElement>(null)
  const prevPaletteRef = useRef(false)
  const prevDialogRef = useRef(false)
  useFocusTrap(sessionDialogRef, sessionDialog !== null)

  useEffect(() => {
    if (prevPaletteRef.current && !paletteOpen) railSearchRef.current?.focus()
    prevPaletteRef.current = paletteOpen
  }, [paletteOpen])

  useEffect(() => {
    if (prevDialogRef.current && sessionDialog === null) sessionButtonRef.current?.focus()
    prevDialogRef.current = sessionDialog !== null
  }, [sessionDialog])
  const [sessionName, setSessionName] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')
  const [sessionList, setSessionList] = useState<{ name: string }[]>([])
  const [sessionBusy, setSessionBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogInputRef = useRef<HTMLInputElement>(null)

  const recording = Boolean(dawStatus?.instances?.some((i) => i.recording))

  useEffect(() => {
    const id = file?.fileId ?? null
    if (!id) {
      lastFileIdRef.current = null
      return
    }
    if (lastFileIdRef.current === id) return
    lastFileIdRef.current = id
    let enabled = false
    try {
      enabled = localStorage.getItem('neiro.prefs.openPlayerAfterImport') === '1'
    } catch {
      /* ignore */
    }
    if (enabled && module === 'import') {
      // The practice panel lives on the MIDI module; focus alone did nothing.
      setModule('midi')
      requestPracticeFocus()
    }
  }, [file, module, requestPracticeFocus])

  useEffect(() => {
    if (file) return
    let alive = true
    void listLibrarySongs()
      .then(({ songs }) => {
        if (alive) setRecentSong(mostRecentSong(songs))
      })
      .catch(() => {
        /* no library yet */
      })
    return () => {
      alive = false
    }
  }, [file])

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
        notes: sessionNotes.trim() || undefined,
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
      const savedNotes =
        typeof res.session?.user_notes === 'string' ? res.session.user_notes : ''
      setSessionNotes(savedNotes)
      setSessionDialog(null)
      flash(
        `Opened “${name}” — packs/MIDI/Studio timeline/corrections restored; re-import audio if URLs expired.` +
          (savedNotes ? ' Notes restored.' : ''),
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

      <aside className="rail" aria-label={t('shell.rail')}>
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
          ref={railSearchRef}
          type="button"
          className="rail-search"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (Ctrl+K)"
          aria-haspopup="dialog"
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
            const label = t(m.labelKey)
            const hint = t(m.hintKey)
            return (
              <button
                key={m.id}
                type="button"
                className={`rail-item${module === m.id ? ' active' : ''}`}
                onClick={() => setModule(m.id)}
                aria-current={module === m.id ? 'page' : undefined}
                title={m.key ? `${hint} (${m.key})` : hint}
              >
                <span className="rail-item-row">
                  <span className="rail-item-main">
                    <ModIcon className="rail-icon" size={20} />
                    <span className="rail-label">{label}</span>
                  </span>
                  {m.key && <span className="rail-key mono faint">{m.key}</span>}
                </span>
                {module === m.id && <span className="rail-hint">{hint}</span>}
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
            {!file && recentSong && (
              <button
                type="button"
                className="ghost"
                title={t('shell.resumeHint')}
                onClick={() => {
                  resumeSong(recentSong.id)
                  setModule('library')
                }}
              >
                {t('shell.resume', { title: recentSong.title })}
              </button>
            )}
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
                ref={sessionButtonRef}
                type="button"
                className="ghost"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls={MENU_KEY}
                disabled={jobRunning || sessionBusy}
                onClick={() => setMenuOpen((v) => !v)}
                title="Session actions"
              >
                {t('shell.session')} ▾
              </button>
              {menuOpen && (
                <div className="session-menu-pop" id={MENU_KEY} role="menu">
                  <button type="button" role="menuitem" onClick={() => void openSaveDialog()}>
                    {t('shell.saveSession')}
                  </button>
                  <button type="button" role="menuitem" onClick={() => void openOpenDialog()}>
                    {t('shell.openSession')}
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
                    {t('shell.newSession')}
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
            ref={sessionDialogRef}
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
            {sessionDialog === 'save' && (
              <label className="field">
                <span>Notes (optional, 5,000 characters)</span>
                <textarea
                  value={sessionNotes}
                  maxLength={5000}
                  rows={4}
                  disabled={sessionBusy}
                  placeholder="Practice notes, mix decisions, what to try next…"
                  onChange={(e) => setSessionNotes(e.target.value)}
                />
                <span className="intent">{sessionNotes.length}/5000</span>
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
              {sessionDialog === 'open' && sessionName && (
                <a
                  className="btn-link"
                  href={`/api/session/export?name=${encodeURIComponent(sessionName)}`}
                  download={`${sessionName}.neiro.json`}
                >
                  Export JSON
                </a>
              )}
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
