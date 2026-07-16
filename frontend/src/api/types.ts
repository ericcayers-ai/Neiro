export type ModuleId =
  | 'import'
  | 'analysis'
  | 'studio'
  | 'separate'
  | 'restore'
  | 'transcribe'
  | 'mixer'
  | 'learn'
  | 'preferences'
  | 'about'

export type WorkspaceMode = 'simple' | 'advanced'

export interface HealthResponse {
  status: 'ok'
  version: string
  engine: string
}

export interface VersionResponse {
  name: string
  version: string
  api_version: number
}

export interface InstrumentHint {
  instrument: string
  status: 'asserted' | 'tentative' | string
}

export interface AnalysisReport {
  duration_seconds: number
  sample_rate: number
  channels: number
  is_effectively_mono?: boolean
  integrated_lufs?: number | null
  peak_dbfs?: number | null
  estimated_bpm?: number | null
  estimated_key?: string | null
  bandwidth_hz?: number | null
  instruments?: InstrumentHint[]
  notes?: string[]
}

export interface UploadResponse {
  file_id: string
  name: string
  audio_url: string
  report: AnalysisReport
}

export interface WaveformData {
  width: number
  min: number[]
  max: number[]
  duration: number
}

export interface SpectrogramData {
  rows: number
  cols: number
  fmin: number
  fmax: number
  duration: number
  data: number[]
}

export interface EditResponse {
  file_id: string
  parent: string
  op: string
  audio_url: string
  duration: number
  waveform: WaveformData
}

export interface StemFile {
  name: string
  url: string
  meta_url?: string
  file_id?: string
}

export interface SeparateResult {
  model: string
  files: StemFile[]
  notes?: string[]
  source_url?: string
  null_test_db?: number
}

export interface MidiEvent {
  onset: number
  offset: number
  pitch: number
  velocity: number
  confidence: number
}

export interface TranscribeResult {
  model: string
  used_split?: boolean
  notes?: string[]
  tempo_bpm: number
  event_count: number
  midi_url: string
  tracks: Record<string, MidiEvent[]>
  job_id?: string
  svg_url?: string
}

export interface EnhanceResult {
  chain: string[]
  notes?: string[]
  file_url?: string
  file_id?: string
}

export type JobKind = 'separate' | 'transcribe' | 'enhance'

export interface JobStatus {
  status: 'running' | 'done' | 'error' | 'cancelled'
  kind: JobKind
  progress: string[]
  result?: SeparateResult | TranscribeResult | EnhanceResult
  error?: string
}

export interface ExportFormat {
  id: 'wav16' | 'wav24' | 'flac'
  label: string
  intent: string
}
