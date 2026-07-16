import type {
  EditResponse,
  EnhanceResult,
  HealthResponse,
  JobStatus,
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

export async function startSeparate(fileId: string, preset: string): Promise<{ job_id: string }> {
  const res = await fetch('/api/separate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, preset }),
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
