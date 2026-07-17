export type ModuleId =
  | 'import'
  | 'analysis'
  | 'studio'
  | 'separate'
  | 'restore'
  | 'midi'
  | 'transcribe' // legacy → midi
  | 'mixer'
  | 'learn' // legacy → midi (Practice)
  | 'preferences'
  | 'about'

/** MIDI Studio workspace modes. */
export type MidiStudioMode = 'transcribe' | 'roll' | 'roll-score' | 'edit' | 'practice'

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
  confidence?: number
  status: 'asserted' | 'tentative' | string
  source?: 'dsp' | 'neural' | 'vote' | string
}

export interface StemEchoHit {
  delay_s: number
  confidence: number
  candidates_ms?: { ms: number; confidence: number }[]
}

export interface EchoCandidate {
  ms: number
  confidence: number
}

export interface VocalConditions {
  stereo_correlation?: number
  hum_hz?: number
  hum_prominence_db?: number
  echo_delay_s?: number
  echo_confidence?: number
  echo_source?: string
  echo_based_on_preview_split?: boolean
  echo_candidates_ms?: EchoCandidate[]
  stem_echo?: Record<string, StemEchoHit>
  rt60_s?: number
  [key: string]: unknown
}

/** Sparse overlay matching backend ``AnalysisCorrections`` (overrides + reasons). */
export interface AnalysisCorrectionsPayload {
  overrides: Record<string, unknown>
  reasons: Record<string, string>
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
  clipping_ratio?: number | null
  noise_floor_dbfs?: number | null
  instruments?: InstrumentHint[]
  vocal_conditions?: VocalConditions
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

export interface EditSplitHalf {
  file_id: string
  audio_url: string
  duration: number
}

export interface EditResponse {
  file_id: string
  parent: string
  parents?: string[]
  op: string
  audio_url: string
  duration: number
  waveform: WaveformData
  left?: EditSplitHalf
  right?: EditSplitHalf
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

/** Multi-song mashup pack metadata (track ids live in Studio after load). */
export interface StemPack {
  id: string
  name: string
  sourceFileId: string
  bpm: number | null
  key: string | null
  trackIds: string[]
}

export interface StemPackStem {
  name: string
  fileId: string
  url: string
}

/** Intent queued for Studio to load stems as a pack (replace or append). */
export interface StudioPackIntent {
  mode: 'replace' | 'add'
  name: string
  sourceFileId: string
  sourceUrl?: string
  bpm: number | null
  key: string | null
  stems: StemPackStem[]
  /** When adding a pack, stretch stems to this target BPM if different. */
  alignToBpm?: number | null
  alignToKey?: string | null
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
  musicxml_url?: string
  provenance_url?: string
  score_svg_url?: string
  score_pdf_url?: string
  score_renderer?: string
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

export interface PitchCorrectResult {
  file_id: string
  parent?: string
  op?: string
  audio_url: string
  duration: number
  waveform?: WaveformData
  provenance?: string | string[] | null
  notes?: string[]
}

export type JobKind = 'separate' | 'transcribe' | 'enhance' | 'import' | 'download' | 'pitch_correct'

export interface ProgressEvent {
  stage: string
  fraction: number
  eta_s: number | null
  line: string
  node_id?: string
  message?: string
}

export interface JobStatus {
  status: 'running' | 'done' | 'error' | 'cancelled'
  kind: JobKind
  progress: string[]
  progress_events?: ProgressEvent[]
  stage?: string | null
  fraction?: number | null
  eta_s?: number | null
  result?: SeparateResult | TranscribeResult | EnhanceResult | PitchCorrectResult
  error?: string
}

export interface PrefsResponse {
  cache_budget_gb: number
  warm_pool_ttl_s: number
  cache_entries: number
  cache_hits: number
  cache_misses: number
  cache_disk_usage_bytes: number
  resident_models: string[]
  flushed_models?: string[]
  cache_cleared?: boolean
}

export interface ExportFormat {
  id: 'wav16' | 'wav24' | 'flac'
  label: string
  intent: string
}
