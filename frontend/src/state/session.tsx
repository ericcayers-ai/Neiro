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
import { cancelJob, getJob } from '../api/client'
import type {
  AnalysisCorrectionsPayload,
  AnalysisReport,
  EnhanceResult,
  JobKind,
  JobStatus,
  ModuleId,
  SeparateResult,
  TranscribeResult,
} from '../api/types'

const MODULE_KEY = 'neiro.session.module'
const FILE_META_KEY = 'neiro.session.fileMeta'
const CORRECTIONS_KEY = 'neiro.session.analysisCorrections'

export interface SessionFile {
  fileId: string
  name: string
  audioUrl: string
  report: AnalysisReport
}

export interface SessionJob {
  /** Server job id when known; local synthetic id for import stages. */
  id: string
  kind: JobKind
  label: string
  module: ModuleId
  status: JobStatus['status']
  progress: string[]
  fraction: number | null
  stage: string | null
  eta_s: number | null
  error: string | null
  result?: SeparateResult | TranscribeResult | EnhanceResult
  updatedAt: number
}

interface StartEngineJobOpts {
  kind: Exclude<JobKind, 'import'>
  label: string
  module: ModuleId
  startFn: () => Promise<{ job_id: string }>
}

interface StartLocalJobOpts {
  kind: 'import'
  label: string
  module: ModuleId
  run: (report: (stage: string, fraction: number, line?: string) => void) => Promise<void>
}

interface SessionState {
  module: ModuleId
  setModule: (m: ModuleId) => void
  file: SessionFile | null
  setFile: (f: SessionFile | null) => void
  clearSession: () => void
  openInStudio: (fileId: string, audioUrl: string, name?: string) => void
  studioTarget: { fileId: string; audioUrl: string; name: string } | null
  clearStudioTarget: () => void
  /** When true, Studio should open the Mix drawer (e.g. after Separate or mixer redirect). */
  studioMixOpen: boolean
  setStudioMixOpen: (open: boolean) => void
  openStudioMix: () => void
  /** When true, Transcribe should scroll/focus the Practice panel (shortcut 8 / Learn redirect). */
  practiceFocus: boolean
  requestPracticeFocus: () => void
  clearPracticeFocus: () => void
  separateResult: SeparateResult | null
  setSeparateResult: (r: SeparateResult | null) => void
  transcribeResult: TranscribeResult | null
  setTranscribeResult: (r: TranscribeResult | null) => void
  enhanceResult: EnhanceResult | null
  setEnhanceResult: (r: EnhanceResult | null) => void
  /** Applied AnalysisCorrections overlay (backend-compatible) for planners. */
  analysisCorrections: AnalysisCorrectionsPayload | null
  setAnalysisCorrections: (c: AnalysisCorrectionsPayload | null) => void
  jobs: SessionJob[]
  startEngineJob: (opts: StartEngineJobOpts) => Promise<JobStatus | null>
  startLocalJob: (opts: StartLocalJobOpts) => Promise<{ ok: true } | { ok: false; error: string }>
  cancelSessionJob: (id: string) => Promise<void>
  dismissJob: (id: string) => void
  jobForKind: (kind: JobKind) => SessionJob | null
  jobRunning: boolean
  jobLabel: string | null
  requestCancel: () => void
  engineStatus: 'unknown' | 'ok' | 'down'
  setEngineStatus: (s: 'unknown' | 'ok' | 'down') => void
}

const Ctx = createContext<SessionState | null>(null)

function readStoredModule(): ModuleId {
  try {
    const v = sessionStorage.getItem(MODULE_KEY)
    if (v === 'mixer') return 'studio'
    if (v) return v as ModuleId
  } catch {
    /* ignore */
  }
  return 'import'
}

function localJobId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function readStoredCorrections(): AnalysisCorrectionsPayload | null {
  try {
    const raw = sessionStorage.getItem(CORRECTIONS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AnalysisCorrectionsPayload
    if (!parsed || typeof parsed !== 'object') return null
    return {
      overrides: { ...(parsed.overrides || {}) },
      reasons: { ...(parsed.reasons || {}) },
    }
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [module, setModuleState] = useState<ModuleId>(readStoredModule)
  const [file, setFileState] = useState<SessionFile | null>(null)
  const [studioTarget, setStudioTarget] = useState<{
    fileId: string
    audioUrl: string
    name: string
  } | null>(null)
  const [studioMixOpen, setStudioMixOpen] = useState(() => {
    try {
      return sessionStorage.getItem(MODULE_KEY) === 'mixer'
    } catch {
      return false
    }
  })
  const [separateResult, setSeparateResult] = useState<SeparateResult | null>(null)
  const [transcribeResult, setTranscribeResult] = useState<TranscribeResult | null>(null)
  const [enhanceResult, setEnhanceResult] = useState<EnhanceResult | null>(null)
  const [analysisCorrections, setAnalysisCorrectionsState] =
    useState<AnalysisCorrectionsPayload | null>(readStoredCorrections)
  const [practiceFocus, setPracticeFocus] = useState(false)
  const [jobs, setJobs] = useState<SessionJob[]>([])
  const [engineStatus, setEngineStatus] = useState<'unknown' | 'ok' | 'down'>('unknown')
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const pollActive = useRef(true)

  const setAnalysisCorrections = useCallback((c: AnalysisCorrectionsPayload | null) => {
    setAnalysisCorrectionsState(c)
    try {
      if (c && Object.keys(c.overrides || {}).length) {
        sessionStorage.setItem(CORRECTIONS_KEY, JSON.stringify(c))
      } else {
        sessionStorage.removeItem(CORRECTIONS_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const setModule = useCallback((m: ModuleId) => {
    let next: ModuleId = m
    if (next === 'mixer') {
      next = 'studio'
      setStudioMixOpen(true)
    }
    setModuleState(next)
    try {
      sessionStorage.setItem(MODULE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const requestPracticeFocus = useCallback(() => {
    setPracticeFocus(true)
    setModuleState('transcribe')
    try {
      sessionStorage.setItem(MODULE_KEY, 'transcribe')
    } catch {
      /* ignore */
    }
  }, [])

  const clearPracticeFocus = useCallback(() => setPracticeFocus(false), [])

  const setFile = useCallback(
    (f: SessionFile | null) => {
      setFileState((prev) => {
        const fileChanged = !f || !prev || prev.fileId !== f.fileId
        if (fileChanged) {
          // Defer so we don't nest setState updates.
          queueMicrotask(() => setAnalysisCorrections(null))
        }
        return f
      })
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
    },
    [setAnalysisCorrections],
  )

  const upsertJob = useCallback((job: SessionJob) => {
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === job.id)
      if (i < 0) return [job, ...prev].slice(0, 24)
      const next = [...prev]
      next[i] = job
      return next
    })
  }, [])

  const patchJob = useCallback((id: string, patch: Partial<SessionJob>) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j)),
    )
  }, [])

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }, [])

  const clearSession = useCallback(() => {
    setFile(null)
    setSeparateResult(null)
    setTranscribeResult(null)
    setEnhanceResult(null)
    setAnalysisCorrections(null)
    setStudioTarget(null)
    setJobs([])
    setModule('import')
  }, [setFile, setModule, setAnalysisCorrections])

  const openInStudio = useCallback(
    (fileId: string, audioUrl: string, name = 'audio') => {
      setStudioTarget({ fileId, audioUrl, name })
      setModule('studio')
    },
    [setModule],
  )

  const clearStudioTarget = useCallback(() => setStudioTarget(null), [])

  const openStudioMix = useCallback(() => {
    setStudioMixOpen(true)
    setModule('studio')
  }, [setModule])

  const jobForKind = useCallback(
    (kind: JobKind) => jobs.find((j) => j.kind === kind) || null,
    [jobs],
  )

  const startEngineJob = useCallback(
    async ({ kind, label, module: mod, startFn }: StartEngineJobOpts) => {
      const placeholderId = localJobId()
      upsertJob({
        id: placeholderId,
        kind,
        label,
        module: mod,
        status: 'running',
        progress: ['queued…'],
        fraction: 0,
        stage: 'queued',
        eta_s: null,
        error: null,
        updatedAt: Date.now(),
      })
      try {
        const { job_id } = await startFn()
        setJobs((prev) =>
          prev.map((j) =>
            j.id === placeholderId
              ? { ...j, id: job_id, progress: ['queued…'], updatedAt: Date.now() }
              : j,
          ),
        )
        // Poll until terminal; session-owned so tab switches never stop it.
        for (;;) {
          if (!pollActive.current) return null
          const job = await getJob(job_id)
          patchJob(job_id, {
            status: job.status,
            progress: job.progress?.length ? job.progress : ['working…'],
            fraction: job.fraction ?? null,
            stage: job.stage ?? null,
            eta_s: job.eta_s ?? null,
            error:
              job.status === 'error'
                ? job.error || 'Job failed'
                : job.status === 'cancelled'
                  ? 'Cancelled.'
                  : null,
            result: job.result,
          })
          if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
            return job
          }
          await new Promise((r) => setTimeout(r, 400))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        patchJob(placeholderId, { status: 'error', error: msg, fraction: null })
        return null
      }
    },
    [patchJob, upsertJob],
  )

  const startLocalJob = useCallback(
    async ({ kind, label, module: mod, run }: StartLocalJobOpts) => {
      const id = localJobId()
      upsertJob({
        id,
        kind,
        label,
        module: mod,
        status: 'running',
        progress: ['starting…'],
        fraction: 0,
        stage: 'starting',
        eta_s: null,
        error: null,
        updatedAt: Date.now(),
      })
      const report = (stage: string, fraction: number, line?: string) => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  stage,
                  fraction,
                  progress: [...j.progress, line || stage].slice(-80),
                  updatedAt: Date.now(),
                }
              : j,
          ),
        )
      }
      try {
        await run(report)
        patchJob(id, { status: 'done', fraction: 1, stage: 'done' })
        return { ok: true as const }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        patchJob(id, { status: 'error', error: msg })
        return { ok: false as const, error: msg }
      }
    },
    [patchJob, upsertJob],
  )

  const cancelSessionJob = useCallback(
    async (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id)
      if (!job || job.status !== 'running') return
      if (job.kind === 'import') {
        patchJob(id, { status: 'cancelled', error: 'Cancelled.' })
        return
      }
      try {
        await cancelJob(id)
      } catch {
        /* best effort — poller will pick up cancelled state */
      }
    },
    [patchJob],
  )

  const runningJobs = useMemo(() => jobs.filter((j) => j.status === 'running'), [jobs])
  const jobRunning = runningJobs.length > 0
  const jobLabel = runningJobs[0]?.label ?? null

  const requestCancel = useCallback(() => {
    const first = jobsRef.current.find((j) => j.status === 'running')
    if (first) void cancelSessionJob(first.id)
  }, [cancelSessionJob])

  useEffect(() => {
    pollActive.current = true
    return () => {
      pollActive.current = false
    }
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
      file,
      setFile,
      clearSession,
      openInStudio,
      studioTarget,
      clearStudioTarget,
      studioMixOpen,
      setStudioMixOpen,
      openStudioMix,
      practiceFocus,
      requestPracticeFocus,
      clearPracticeFocus,
      separateResult,
      setSeparateResult,
      transcribeResult,
      setTranscribeResult,
      enhanceResult,
      setEnhanceResult,
      analysisCorrections,
      setAnalysisCorrections,
      jobs,
      startEngineJob,
      startLocalJob,
      cancelSessionJob,
      dismissJob,
      jobForKind,
      jobRunning,
      jobLabel,
      requestCancel,
      engineStatus,
      setEngineStatus,
    }),
    [
      module,
      setModule,
      file,
      setFile,
      clearSession,
      openInStudio,
      studioTarget,
      clearStudioTarget,
      studioMixOpen,
      openStudioMix,
      practiceFocus,
      requestPracticeFocus,
      clearPracticeFocus,
      separateResult,
      transcribeResult,
      enhanceResult,
      analysisCorrections,
      setAnalysisCorrections,
      jobs,
      startEngineJob,
      startLocalJob,
      cancelSessionJob,
      dismissJob,
      jobForKind,
      jobRunning,
      jobLabel,
      requestCancel,
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
