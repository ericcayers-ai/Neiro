import type {
  AnalysisCorrectionsPayload,
  EditResponse,
  EnhanceResult,
  HealthResponse,
  JobStatus,
  MidiEvent,
  PrefsResponse,
  SeparateResult,
  SpectrogramData,
  TranscribeResult,
  UploadResponse,
  VersionResponse,
  WaveformData,
} from './types'

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health', { cache: 'no-store' })
  return readJson(res)
}

export async function fetchVersion(): Promise<VersionResponse> {
  const res = await fetch('/api/version', { cache: 'no-store' })
  return readJson(res)
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText)
  }
  return data
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: file,
    headers: { 'X-Filename': file.name },
  })
  return readJson(res)
}

export async function ingestUrl(url: string): Promise<UploadResponse> {
  const res = await fetch('/api/ingest-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return readJson(res)
}

export async function startSeparate(
  fileId: string,
  preset: string,
  opts?: {
    quality?: string
    bleed_suppress?: boolean | string
    corrections?: AnalysisCorrectionsPayload | null
  },
): Promise<{ job_id: string }> {
  const res = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      preset,
      quality: opts?.quality,
      bleed_suppress: opts?.bleed_suppress,
      corrections: opts?.corrections || undefined,
    }),
  })
  return readJson(res)
}

export interface PlanStripPayload {
  kind: string
  model_id?: string | null
  notes: string[]
  quality?: string | null
  nodes: { id: string; type: string; config: string }[]
  edges: { from: string; to: string; from_port: string; to_port: string }[]
  stem_ports?: string[]
  chain?: string[]
}

export async function fetchPlan(params: {
  kind: string
  file_id: string
  preset?: string
  quality?: string
  bleed_suppress?: string
  mode?: string
  model?: string
  members?: string[]
  chain?: string
  corrections?: AnalysisCorrectionsPayload | null
}): Promise<PlanStripPayload> {
  const q = new URLSearchParams({ kind: params.kind, file_id: params.file_id })
  if (params.preset) q.set('preset', params.preset)
  if (params.quality) q.set('quality', params.quality)
  if (params.bleed_suppress) q.set('bleed_suppress', params.bleed_suppress)
  if (params.mode) q.set('mode', params.mode)
  if (params.model) q.set('model', params.model)
  if (params.members?.length) q.set('members', params.members.join(','))
  if (params.chain) q.set('chain', params.chain)
  if (params.corrections && Object.keys(params.corrections.overrides || {}).length) {
    q.set('corrections', JSON.stringify(params.corrections))
  }
  const res = await fetch(`/api/plan?${q}`, { cache: 'no-store' })
  return readJson(res)
}

export async function flushCompute(): Promise<{ ok: boolean; flushed: string[] }> {
  const res = await fetch('/api/compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'flush' }),
  })
  return readJson(res)
}

export async function saveSession(body: {
  name: string
  file_id?: string | null
  graph_config?: Record<string, unknown>
}): Promise<{ ok: boolean; name: string }> {
  const res = await fetch('/api/session/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

export async function listSessions(): Promise<{ sessions: { name: string; path: string }[] }> {
  const res = await fetch('/api/session/list', { cache: 'no-store' })
  return readJson(res)
}

export async function openSession(name: string): Promise<{ ok: boolean; session: Record<string, unknown> }> {
  const res = await fetch('/api/session/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return readJson(res)
}

export async function editNotes(
  jobId: string,
  body: Record<string, unknown>,
): Promise<{ tracks: Record<string, MidiEvent[]>; tempo_bpm: number }> {
  const res = await fetch(`/api/notes/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

export async function startTranscribe(
  fileId: string,
  mode: string,
  model?: string,
  opts?: {
    members?: string[]
    ensemble?: boolean
    corrections?: AnalysisCorrectionsPayload | null
  },
): Promise<{ job_id: string }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      mode,
      model: model || undefined,
      members: opts?.members,
      ensemble: opts?.ensemble,
      corrections: opts?.corrections || undefined,
    }),
  })
  return readJson(res)
}

export interface ModelStatus {
  id: string
  task: string
  display_name: string
  quality_class: string
  available: boolean
  downloaded: boolean
  needs_download: boolean
  status: 'ready' | 'needs-install' | 'needs-download' | string
  requires: string[]
  license_spdx: string
  size_hint?: string | null
}

export async function fetchModels(task?: string): Promise<ModelStatus[]> {
  const q = task ? `?task=${encodeURIComponent(task)}` : ''
  const res = await fetch(`/api/models${q}`, { cache: 'no-store' })
  const data = await readJson<{ models: ModelStatus[]; packs?: Record<string, string[]> }>(res)
  return data.models
}

export async function fetchModelsFull(): Promise<{
  models: ModelStatus[]
  packs: Record<string, string[]>
}> {
  const res = await fetch('/api/models', { cache: 'no-store' })
  const data = await readJson<{ models: ModelStatus[]; packs?: Record<string, string[]> }>(res)
  return { models: data.models, packs: data.packs || {} }
}

export async function startModelDownload(opts: {
  model_id?: string
  model_ids?: string[]
  pack?: string
}): Promise<{ job_id: string; model_ids: string[] }> {
  const res = await fetch('/api/models/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  return readJson(res)
}

export interface ToolsStatus {
  verovio: { installed: boolean; hint?: string }
  musescore: { path: string | null; installed: boolean; download_url?: string }
  soundfont: { installed: boolean; files: string[]; urls?: string[]; hint?: string }
  packs: Record<string, string[]>
}

export async function fetchToolsStatus(): Promise<ToolsStatus> {
  const res = await fetch('/api/tools', { cache: 'no-store' })
  return readJson(res)
}

export async function installTool(tool: 'verovio' | 'soundfont'): Promise<{
  ok: boolean
  error?: string
  status?: ToolsStatus
  path?: string
}> {
  const res = await fetch('/api/tools/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool }),
  })
  return readJson(res)
}

export async function setMuseScorePath(path: string | null): Promise<{
  ok: boolean
  error?: string
  path?: string | null
  status?: ToolsStatus
}> {
  const res = await fetch('/api/tools/musescore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return readJson(res)
}

export async function startEnhance(
  fileId: string,
  chain: string,
  corrections?: AnalysisCorrectionsPayload | null,
): Promise<{ job_id: string }> {
  const res = await fetch('/api/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      chain,
      corrections: corrections || undefined,
    }),
  })
  return readJson(res)
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`/api/job/${jobId}`)
  return readJson(res)
}

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/job/${jobId}/cancel`, { method: 'POST' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || res.statusText)
  }
}

export async function fetchPrefs(): Promise<PrefsResponse> {
  const res = await fetch('/api/prefs', { cache: 'no-store' })
  return readJson(res)
}

export async function updatePrefs(body: {
  cache_budget_gb?: number
  warm_pool_ttl_s?: number
}): Promise<PrefsResponse> {
  const res = await fetch('/api/prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

export async function flushPrefs(clearCache = false): Promise<PrefsResponse> {
  const res = await fetch('/api/prefs/flush', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear_cache: clearCache }),
  })
  return readJson(res)
}

export async function fetchWaveform(
  fileId: string,
  width = 1400,
  range?: { start?: number; end?: number },
): Promise<WaveformData> {
  const q = new URLSearchParams({ file_id: fileId, width: String(width) })
  if (range?.start != null) q.set('start', String(range.start))
  if (range?.end != null) q.set('end', String(range.end))
  const res = await fetch(`/api/waveform?${q}`)
  return readJson(res)
}

export async function fetchSpectrogram(
  fileId: string,
  range?: { start?: number; end?: number },
): Promise<SpectrogramData> {
  const q = new URLSearchParams({ file_id: fileId })
  if (range?.start != null) q.set('start', String(range.start))
  if (range?.end != null) q.set('end', String(range.end))
  const res = await fetch(`/api/spectrogram?${q}`)
  return readJson(res)
}

export type EditOp =
  | 'trim'
  | 'delete'
  | 'silence'
  | 'fade_in'
  | 'fade_out'
  | 'gain'
  | 'reverse'
  | 'normalize'
  | 'split'
  | 'bounce'
  | 'combine'
  | 'time_stretch'
  | 'pitch_shift'
  | 'pitch_correct'

export interface BounceTrack {
  file_id: string
  gain?: number
  pan?: number
  offset?: number
}

export async function applyEdit(body: {
  file_id?: string
  op: EditOp
  start?: number
  end?: number
  at?: number
  db?: number
  target_dbfs?: number
  tracks?: BounceTrack[]
  rate?: number
  semitones?: number
  key?: string
  strength?: number
}): Promise<EditResponse> {
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

export async function bounceTracks(tracks: BounceTrack[]): Promise<EditResponse> {
  return applyEdit({ op: 'bounce', tracks })
}

export async function timeStretchFile(fileId: string, rate: number): Promise<EditResponse> {
  return applyEdit({ file_id: fileId, op: 'time_stretch', rate })
}

export async function pitchShiftFile(fileId: string, semitones: number): Promise<EditResponse> {
  return applyEdit({ file_id: fileId, op: 'pitch_shift', semitones })
}

export async function pitchCorrectFile(
  fileId: string,
  opts?: { key?: string; strength?: number },
): Promise<{ job_id: string }> {
  const res = await fetch('/api/pitch_correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      key: opts?.key,
      strength: opts?.strength ?? 1,
    }),
  })
  return readJson(res)
}

/** Resolve immediate parent / root original for an edited file (Reset to original). */
export async function fetchFileParent(fileId: string): Promise<{
  file_id: string
  parent: string | null
  original: string | null
}> {
  const res = await fetch(`/api/file/${encodeURIComponent(fileId)}/parent`, { cache: 'no-store' })
  return readJson(res)
}

/** Sync edit path kept for non-job ops; prefer pitchCorrectFile + poll for pitch. */
export async function pitchCorrectFileSync(
  fileId: string,
  opts?: { key?: string; strength?: number },
): Promise<EditResponse> {
  return applyEdit({
    file_id: fileId,
    op: 'pitch_correct',
    key: opts?.key,
    strength: opts?.strength ?? 1,
  })
}

export async function reanalyzeFile(
  fileId: string,
): Promise<{ file_id: string; estimated_bpm: number | null; estimated_key: string | null }> {
  const q = new URLSearchParams({ file_id: fileId })
  const res = await fetch(`/api/analyze?${q}`, { cache: 'no-store' })
  return readJson(res)
}

export function exportUrl(fileId: string, format: 'wav16' | 'wav24' | 'flac'): string {
  return `/api/export?file_id=${encodeURIComponent(fileId)}&format=${format}`
}

export type { SeparateResult, TranscribeResult, EnhanceResult }
