/** Build / restore extended session graph_config (Wave 5 persistence). */

import type {
  AnalysisCorrectionsPayload,
  MidiEvent,
  MidiStudioMode,
  ModuleId,
  StemPack,
  TranscribeResult,
} from '../api/types'

const DRAFT_KEY = 'neiro.session.analysisCorrectionsDraft'
const MIDI_MODE_KEY = 'neiro.midi.mode'
const STUDIO_TRACKS_KEY = 'neiro.session.studioTracks'
/** Dispatched on window after Save/Open restores studio tracks into sessionStorage. */
export const STUDIO_TRACKS_EVENT = 'neiro:studio-tracks'

export interface AnalysisCorrectionsDraft {
  instruments: string[]
  key: string
  bpm: string
  dismissed: string[]
  fileId?: string
}

export interface MidiNoteEditsSnapshot {
  job_id?: string
  model?: string
  tempo_bpm?: number
  tracks: Record<string, MidiEvent[]>
  midi_url?: string
  musicxml_url?: string
  event_count?: number
}

export interface StudioClipSnap {
  id: string
  sourceStart: number
  sourceEnd: number
  offset: number
}

export interface StudioTrackSnap {
  id: string
  name: string
  fileId: string
  audioUrl: string
  color: string
  mute: boolean
  solo: boolean
  gain: number
  pan: number
  duration: number
  packId?: string
  clips: StudioClipSnap[]
}

export interface SessionGraphConfig {
  module?: ModuleId
  stemPacks?: StemPack[]
  midiMode?: MidiStudioMode
  midiNoteEdits?: MidiNoteEditsSnapshot | null
  analysisCorrections?: AnalysisCorrectionsPayload | null
  analysisCorrectionsDraft?: AnalysisCorrectionsDraft | null
  /** Studio timeline clips/tracks (file URLs must still resolve). */
  studioTracks?: StudioTrackSnap[]
}

export function readMidiMode(): MidiStudioMode {
  try {
    const v = localStorage.getItem(MIDI_MODE_KEY)
    if (
      v === 'transcribe' ||
      v === 'roll' ||
      v === 'roll-score' ||
      v === 'edit' ||
      v === 'practice'
    ) {
      return v
    }
  } catch {
    /* ignore */
  }
  return 'transcribe'
}

export function writeMidiMode(mode: MidiStudioMode) {
  try {
    localStorage.setItem(MIDI_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function readCorrectionsDraft(): AnalysisCorrectionsDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AnalysisCorrectionsDraft
    if (!parsed || typeof parsed !== 'object') return null
    return {
      instruments: Array.isArray(parsed.instruments) ? parsed.instruments : [],
      key: typeof parsed.key === 'string' ? parsed.key : '',
      bpm: typeof parsed.bpm === 'string' ? parsed.bpm : '',
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
      fileId: typeof parsed.fileId === 'string' ? parsed.fileId : undefined,
    }
  } catch {
    return null
  }
}

export function writeCorrectionsDraft(draft: AnalysisCorrectionsDraft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

export function readStudioTracks(): StudioTrackSnap[] | null {
  try {
    const raw = sessionStorage.getItem(STUDIO_TRACKS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StudioTrackSnap[]
    if (!Array.isArray(parsed) || !parsed.length) return null
    return parsed.filter((t) => t && typeof t.id === 'string' && typeof t.fileId === 'string')
  } catch {
    return null
  }
}

export function writeStudioTracks(tracks: StudioTrackSnap[] | null) {
  try {
    if (tracks?.length) sessionStorage.setItem(STUDIO_TRACKS_KEY, JSON.stringify(tracks))
    else sessionStorage.removeItem(STUDIO_TRACKS_KEY)
  } catch {
    /* ignore */
  }
}

/** Persist tracks and notify a mounted Studio module to rehydrate. */
export function restoreStudioTracks(tracks: StudioTrackSnap[] | null) {
  writeStudioTracks(tracks)
  try {
    window.dispatchEvent(
      new CustomEvent(STUDIO_TRACKS_EVENT, {
        detail: { count: tracks?.length ?? 0 },
      }),
    )
  } catch {
    /* ignore */
  }
}

export function snapshotMidiNoteEdits(
  result: TranscribeResult | null,
): MidiNoteEditsSnapshot | null {
  if (!result?.tracks || !Object.keys(result.tracks).length) return null
  return {
    job_id: result.job_id,
    model: result.model,
    tempo_bpm: result.tempo_bpm,
    tracks: result.tracks,
    midi_url: result.midi_url,
    musicxml_url: result.musicxml_url,
    event_count: result.event_count,
  }
}

export function restoreMidiNoteEdits(
  snap: MidiNoteEditsSnapshot | null | undefined,
): TranscribeResult | null {
  if (!snap?.tracks || !Object.keys(snap.tracks).length) return null
  return {
    model: snap.model || 'session-restore',
    tempo_bpm: snap.tempo_bpm || 120,
    event_count:
      snap.event_count ??
      Object.values(snap.tracks).reduce((n, evs) => n + (evs?.length || 0), 0),
    midi_url: snap.midi_url || '',
    musicxml_url: snap.musicxml_url,
    tracks: snap.tracks,
    job_id: snap.job_id,
  }
}

export function buildSessionGraphConfig(opts: {
  module: ModuleId
  stemPacks: StemPack[]
  analysisCorrections: AnalysisCorrectionsPayload | null
  transcribeResult: TranscribeResult | null
  studioTracks?: StudioTrackSnap[] | null
}): SessionGraphConfig {
  const studio = opts.studioTracks ?? readStudioTracks()
  return {
    module: opts.module,
    stemPacks: opts.stemPacks.length ? opts.stemPacks : undefined,
    midiMode: readMidiMode(),
    midiNoteEdits: snapshotMidiNoteEdits(opts.transcribeResult) || undefined,
    analysisCorrections: opts.analysisCorrections || undefined,
    analysisCorrectionsDraft: readCorrectionsDraft() || undefined,
    studioTracks: studio?.length ? studio : undefined,
  }
}

export function parseSessionGraphConfig(raw: unknown): SessionGraphConfig {
  if (!raw || typeof raw !== 'object') return {}
  const cfg = raw as Record<string, unknown>
  const out: SessionGraphConfig = {}
  if (typeof cfg.module === 'string') out.module = cfg.module as ModuleId
  if (Array.isArray(cfg.stemPacks)) {
    out.stemPacks = (cfg.stemPacks as StemPack[]).filter(
      (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds),
    )
  }
  if (
    cfg.midiMode === 'transcribe' ||
    cfg.midiMode === 'roll' ||
    cfg.midiMode === 'roll-score' ||
    cfg.midiMode === 'edit' ||
    cfg.midiMode === 'practice'
  ) {
    out.midiMode = cfg.midiMode
  }
  if (cfg.midiNoteEdits && typeof cfg.midiNoteEdits === 'object') {
    out.midiNoteEdits = cfg.midiNoteEdits as MidiNoteEditsSnapshot
  }
  if (cfg.analysisCorrections && typeof cfg.analysisCorrections === 'object') {
    const ac = cfg.analysisCorrections as AnalysisCorrectionsPayload
    out.analysisCorrections = {
      overrides: { ...(ac.overrides || {}) },
      reasons: { ...(ac.reasons || {}) },
    }
  }
  if (cfg.analysisCorrectionsDraft && typeof cfg.analysisCorrectionsDraft === 'object') {
    out.analysisCorrectionsDraft = cfg.analysisCorrectionsDraft as AnalysisCorrectionsDraft
  }
  if (Array.isArray(cfg.studioTracks)) {
    out.studioTracks = (cfg.studioTracks as StudioTrackSnap[]).filter(
      (t) => t && typeof t.id === 'string' && typeof t.fileId === 'string' && Array.isArray(t.clips),
    )
  }
  return out
}
