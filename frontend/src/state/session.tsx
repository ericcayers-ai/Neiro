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
  MidiStudioMode,
  ModuleId,
  PitchCorrectResult,
  SeparateResult,
  StemPack,
  StudioPackIntent,
  TranscribeResult,
} from '../api/types'

const MODULE_KEY = 'neiro.session.module'
const FILE_META_KEY = 'neiro.session.fileMeta'
const CORRECTIONS_KEY = 'neiro.session.analysisCorrections'
const STEM_PACKS_KEY = 'neiro.session.stemPacks'
/** Poll interval while any engine job is running — denser progress bar updates. */
const JOB_POLL_MS = 400

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
  /** Latest planner node id from progress_events (for DAG highlight). */
  runningNodeId?: string | null
  eta_s: number | null
  error: string | null
  result?: SeparateResult | TranscribeResult | EnhanceResult | PitchCorrectResult
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
  /** Multi-import queue for batch Separate → mashup packs. */
  importQueue: SessionFile[]
  addToImportQueue: (f: SessionFile) => void
  removeFromImportQueue: (fileId: string) => void
  clearImportQueue: () => void
  clearSession: () => void
  openInStudio: (fileId: string, audioUrl: string, name?: string) => void
  studioTarget: { fileId: string; audioUrl: string; name: string } | null
  clearStudioTarget: () => void
  /** When true, Studio should open the Mix drawer (e.g. after Separate or mixer redirect). */
  studioMixOpen: boolean
  setStudioMixOpen: (open: boolean) => void
  openStudioMix: () => void
  /** When true, MIDI Studio focuses Practice mode (shortcut 8 / Learn redirect). */
  practiceFocus: boolean
  requestPracticeFocus: () => void
  clearPracticeFocus: () => void
  /** Preferred MIDI Studio sub-mode after navigation (optional). */
  midiModeFocus: MidiStudioMode | null
  setMidiModeFocus: (m: MidiStudioMode | null) => void
  separateResult: SeparateResult | null
  setSeparateResult: (r: SeparateResult | null) => void
  /** Mashup packs accumulated from Separate → Studio. */
  stemPacks: StemPack[]
  setStemPacks: (packs: StemPack[] | ((prev: StemPack[]) => StemPack[])) => void
  updateStemPack: (id: string, patch: Partial<StemPack>) => void
  /** Queued pack load for Studio (replace timeline or append). */
  studioPackIntent: StudioPackIntent | null
  queueStudioPack: (intent: StudioPackIntent) => void
  clearStudioPackIntent: () => void
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

function canonicalizeModule(m: ModuleId | string): ModuleId {
  if (m === 'mixer') return 'studio'
  if (m === 'transcribe' || m === 'learn') return 'midi'
  return m as ModuleId
}

function readStoredModule(): ModuleId {
  try {
    const v = sessionStorage.getItem(MODULE_KEY)
    if (v) return canonicalizeModule(v)
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

function readStoredStemPacks(): StemPack[] {
  try {
    const raw = sessionStorage.getItem(STEM_PACKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StemPack[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds),
    )
  } catch {
    return []
  }
}

function persistStemPacks(packs: StemPack[]) {
  try {
    if (packs.length) sessionStorage.setItem(STEM_PACKS_KEY, JSON.stringify(packs))
    else sessionStorage.removeItem(STEM_PACKS_KEY)
  } catch {
    /* ignore */
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
  const [importQueue, setImportQueue] = useState<SessionFile[]>([])
  const [stemPacks, setStemPacksState] = useState<StemPack[]>(readStoredStemPacks)
  const [studioPackIntentQueue, setStudioPackIntentQueue] = useState<StudioPackIntent[]>([])
  const studioPackIntent = studioPackIntentQueue[0] ?? null
  const [transcribeResult, setTranscribeResult] = useState<TranscribeResult | null>(null)
  const [enhanceResult, setEnhanceResult] = useState<EnhanceResult | null>(null)
  const [analysisCorrections, setAnalysisCorrectionsState] =
    useState<AnalysisCorrectionsPayload | null>(readStoredCorrections)
  const [practiceFocus, setPracticeFocus] = useState(false)
  const [midiModeFocus, setMidiModeFocus] = useState<MidiStudioMode | null>(null)
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
    let next = canonicalizeModule(m)
    if (m === 'mixer') {
      setStudioMixOpen(true)
    }
    if (m === 'learn') {
      setPracticeFocus(true)
      setMidiModeFocus('practice')
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
    setMidiModeFocus('practice')
    setModuleState('midi')
    try {
      sessionStorage.setItem(MODULE_KEY, 'midi')
    } catch {
      /* ignore */
    }
  }, [])

  const setStemPacks = useCallback((packs: StemPack[] | ((prev: StemPack[]) => StemPack[])) => {
    setStemPacksState((prev) => {
      const next = typeof packs === 'function' ? packs(prev) : packs
      persistStemPacks(next)
      return next
    })
  }, [])

  const updateStemPack = useCallback((id: string, patch: Partial<StemPack>) => {
    setStemPacksState((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
      persistStemPacks(next)
      return next
    })
  }, [])

  const queueStudioPack = useCallback((intent: StudioPackIntent) => {
    setStudioPackIntentQueue((q) => [...q, intent])
    setModule('studio')
  }, [setModule])

  const clearStudioPackIntent = useCallback(
    () => setStudioPackIntentQueue((q) => q.slice(1)),
    [],
  )

  const addToImportQueue = useCallback((f: SessionFile) => {
    setImportQueue((prev) => {
      if (prev.some((x) => x.fileId === f.fileId)) return prev
      return [...prev, f]
    })
  }, [])

  const removeFromImportQueue = useCallback((fileId: string) => {
    setImportQueue((prev) => prev.filter((x) => x.fileId !== fileId))
  }, [])

  const clearImportQueue = useCallback(() => setImportQueue([]), [])

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
    setImportQueue([])
    setStemPacks([])
    setStudioPackIntentQueue([])
    setTranscribeResult(null)
    setEnhanceResult(null)
    setAnalysisCorrections(null)
    setStudioTarget(null)
    setJobs([])
    setModule('import')
  }, [setFile, setModule, setAnalysisCorrections, setStemPacks])

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
          const events = job.progress_events || []
          const lastNode = [...events].reverse().find((e) => e.node_id)?.node_id ?? null
          patchJob(job_id, {
            status: job.status,
            progress: job.progress?.length ? job.progress : ['working…'],
            fraction: job.fraction ?? null,
            stage: job.stage ?? null,
            runningNodeId: job.status === 'running' ? lastNode : null,
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
          await new Promise((r) => setTimeout(r, JOB_POLL_MS))
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
      importQueue,
      addToImportQueue,
      removeFromImportQueue,
      clearImportQueue,
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
      midiModeFocus,
      setMidiModeFocus,
      separateResult,
      setSeparateResult,
      stemPacks,
      setStemPacks,
      updateStemPack,
      studioPackIntent,
      queueStudioPack,
      clearStudioPackIntent,
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
      importQueue,
      addToImportQueue,
      removeFromImportQueue,
      clearImportQueue,
      clearSession,
      openInStudio,
      studioTarget,
      clearStudioTarget,
      studioMixOpen,
      openStudioMix,
      practiceFocus,
      requestPracticeFocus,
      clearPracticeFocus,
      midiModeFocus,
      separateResult,
      stemPacks,
      setStemPacks,
      updateStemPack,
      studioPackIntent,
      queueStudioPack,
      clearStudioPackIntent,
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
