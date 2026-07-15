import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AnalysisReport,
  EnhanceResult,
  ModuleId,
  SeparateResult,
  TranscribeResult,
  WorkspaceMode,
} from '../api/types'

const MODULE_KEY = 'neiro.session.module'
const FILE_META_KEY = 'neiro.session.fileMeta'
const MODE_KEY = 'neiro.session.workspaceMode'

export interface SessionFile {
  fileId: string
  name: string
  audioUrl: string
  report: AnalysisReport
}

interface SessionState {
  module: ModuleId
  setModule: (m: ModuleId) => void
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (m: WorkspaceMode) => void
  file: SessionFile | null
  setFile: (f: SessionFile | null) => void
  clearSession: () => void
  openInStudio: (fileId: string, audioUrl: string, name?: string) => void
  studioTarget: { fileId: string; audioUrl: string; name: string } | null
  clearStudioTarget: () => void
  separateResult: SeparateResult | null
  setSeparateResult: (r: SeparateResult | null) => void
  transcribeResult: TranscribeResult | null
  setTranscribeResult: (r: TranscribeResult | null) => void
  enhanceResult: EnhanceResult | null
  setEnhanceResult: (r: EnhanceResult | null) => void
  jobRunning: boolean
  setJobRunning: (v: boolean) => void
  registerCancel: (fn: (() => void) | null) => void
  requestCancel: () => void
  jobLabel: string | null
  setJobLabel: (s: string | null) => void
  engineStatus: 'unknown' | 'ok' | 'down'
  setEngineStatus: (s: 'unknown' | 'ok' | 'down') => void
}

const Ctx = createContext<SessionState | null>(null)

function readStoredModule(): ModuleId {
  try {
    const v = sessionStorage.getItem(MODULE_KEY)
    if (v) return v as ModuleId
  } catch {
    /* ignore */
  }
  return 'import'
}

function readStoredMode(): WorkspaceMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'advanced' || v === 'simple') return v
  } catch {
    /* ignore */
  }
  return 'simple'
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [module, setModuleState] = useState<ModuleId>(readStoredModule)
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(readStoredMode)
  const [file, setFileState] = useState<SessionFile | null>(null)
  const [studioTarget, setStudioTarget] = useState<{
    fileId: string
    audioUrl: string
    name: string
  } | null>(null)
  const [separateResult, setSeparateResult] = useState<SeparateResult | null>(null)
  const [transcribeResult, setTranscribeResult] = useState<TranscribeResult | null>(null)
  const [enhanceResult, setEnhanceResult] = useState<EnhanceResult | null>(null)
  const [jobRunning, setJobRunning] = useState(false)
  const [jobLabel, setJobLabel] = useState<string | null>(null)
  const [engineStatus, setEngineStatus] = useState<'unknown' | 'ok' | 'down'>('unknown')
  const cancelRef = useRef<(() => void) | null>(null)

  const setModule = useCallback((m: ModuleId) => {
    setModuleState(m)
    try {
      sessionStorage.setItem(MODULE_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  const setWorkspaceMode = useCallback((m: WorkspaceMode) => {
    setWorkspaceModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  const setFile = useCallback((f: SessionFile | null) => {
    setFileState(f)
    try {
      if (f) {
        sessionStorage.setItem(
          FILE_META_KEY,
          JSON.stringify({ fileId: f.fileId, name: f.name, audioUrl: f.audioUrl }),
        )
      } else {
        sessionStorage.removeItem(FILE_META_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const clearSession = useCallback(() => {
    setFile(null)
    setSeparateResult(null)
    setTranscribeResult(null)
    setEnhanceResult(null)
    setStudioTarget(null)
    setJobLabel(null)
    setModule('import')
  }, [setFile, setModule])

  const openInStudio = useCallback((fileId: string, audioUrl: string, name = 'audio') => {
    setStudioTarget({ fileId, audioUrl, name })
    setModule('studio')
  }, [setModule])

  const clearStudioTarget = useCallback(() => setStudioTarget(null), [])
  const registerCancel = useCallback((fn: (() => void) | null) => {
    cancelRef.current = fn
  }, [])
  const requestCancel = useCallback(() => {
    cancelRef.current?.()
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (!alive) return
        setEngineStatus(res.ok ? 'ok' : 'down')
      } catch {
        if (alive) setEngineStatus('down')
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const value = useMemo(
    () => ({
      module,
      setModule,
      workspaceMode,
      setWorkspaceMode,
      file,
      setFile,
      clearSession,
      openInStudio,
      studioTarget,
      clearStudioTarget,
      separateResult,
      setSeparateResult,
      transcribeResult,
      setTranscribeResult,
      enhanceResult,
      setEnhanceResult,
      jobRunning,
      setJobRunning,
      registerCancel,
      requestCancel,
      jobLabel,
      setJobLabel,
      engineStatus,
      setEngineStatus,
    }),
    [
      module,
      setModule,
      workspaceMode,
      setWorkspaceMode,
      file,
      setFile,
      clearSession,
      openInStudio,
      studioTarget,
      clearStudioTarget,
      separateResult,
      transcribeResult,
      enhanceResult,
      jobRunning,
      registerCancel,
      requestCancel,
      jobLabel,
      engineStatus,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
