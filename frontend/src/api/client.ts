import type {
  EditResponse,
  EnhanceResult,
  HealthResponse,
  JobStatus,
  MidiEvent,
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
  opts?: { quality?: string; bleed_suppress?: boolean | string },
): Promise<{ job_id: string }> {
  const res = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_id: fileId,
      preset,
      quality: opts?.quality,
      bleed_suppress: opts?.bleed_suppress,
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
  chain?: string
}): Promise<PlanStripPayload> {
  const q = new URLSearchParams({ kind: params.kind, file_id: params.file_id })
  if (params.preset) q.set('preset', params.preset)
  if (params.quality) q.set('quality', params.quality)
  if (params.bleed_suppress) q.set('bleed_suppress', params.bleed_suppress)
  if (params.mode) q.set('mode', params.mode)
  if (params.chain) q.set('chain', params.chain)
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
): Promise<{ job_id: string }> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, mode, model }),
  })
  return readJson(res)
}

export async function startEnhance(
  fileId: string,
  chain: string,
): Promise<{ job_id: string }> {
  const res = await fetch('/api/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, chain }),
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

export async function applyEdit(body: {
  file_id: string
  op: EditOp
  start?: number
  end?: number
  db?: number
  target_dbfs?: number
}): Promise<EditResponse> {
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readJson(res)
}

export function exportUrl(fileId: string, format: 'wav16' | 'wav24' | 'flac'): string {
  return `/api/export?file_id=${encodeURIComponent(fileId)}&format=${format}`
}

export type { SeparateResult, TranscribeResult, EnhanceResult }
