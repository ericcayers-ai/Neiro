import { useEffect, useRef, useState } from 'react'
import {
  editNotes,
  fetchModels,
  fetchToolsStatus,
  startModelDownload,
  startTranscribe,
  type ModelStatus,
  type ToolsStatus,
} from '../api/client'
import { useLocalJsonPref, useLocalPref } from '../api/hooks'
import type { MidiEvent, MidiStudioMode, TranscribeResult } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { ModuleHeader } from '../components/ModuleHeader'
import { PlanStrip } from '../components/PlanStrip'
import {
  TRANSCRIBE_MODES,
  TRANSCRIBE_MODELS,
  TRANSCRIBE_QUALITY_PRESETS,
  stemColor,
} from '../constants/options'
import { useSession } from '../state/session'
import { MidiPracticePanel } from './midi/MidiPracticePanel'
import {
  DEFAULT_ROLL_OPTIONS,
  PianoRollView,
  type RollOptions,
} from './midi/PianoRollView'
import './modules.css'

const MODES: { id: MidiStudioMode; label: string; hint: string }[] = [
  { id: 'transcribe', label: 'Transcribe', hint: 'Run decoders → MIDI' },
  { id: 'roll', label: 'Roll', hint: 'Vertical piano roll' },
  { id: 'roll-score', label: 'Roll + score', hint: 'Roll with scrolling score' },
  { id: 'edit', label: 'Edit', hint: 'Draw / select / quantize' },
  { id: 'practice', label: 'Practice', hint: 'Rubber Band + wait modes' },
]

function statusLabel(status: string | undefined): string {
  if (status === 'ready') return ''
  if (status === 'needs-download') return ' (needs download)'
  if (status === 'needs-install') return ' (needs install)'
  return status ? ` (${status})` : ''
}

function statusBadge(status: string | undefined): string {
  if (!status || status === 'ready') return 'ready'
  if (status === 'needs-download') return 'needs download'
  if (status === 'needs-install') return 'needs install'
  return status
}

/** Prefs deep-link: filter Models table to transcription, jump to Tools when asked. */
function openPrefs(section: 'models' | 'tools' = 'models') {
  try {
    if (section === 'models') {
      localStorage.setItem('neiro.pref.modelsTask', 'transcribe')
    }
    sessionStorage.setItem('neiro.pref.scroll', section === 'tools' ? 'prefs-tools' : 'prefs-models')
  } catch {
    /* ignore */
  }
}

type UndoEntry = { tracks: Record<string, MidiEvent[]>; tempo_bpm: number }

function applyTracks(
  result: TranscribeResult,
  tracks: Record<string, MidiEvent[]>,
  tempo_bpm: number,
): TranscribeResult {
  return {
    ...result,
    tracks,
    tempo_bpm,
    event_count: Object.values(tracks).reduce((n, t) => n + t.length, 0),
  }
}

function ScorePane({
  result,
  playhead,
  tools,
  onOpenPrefs,
}: {
  result: TranscribeResult
  playhead: number
  tools: ToolsStatus | null
  onOpenPrefs: (section?: 'models' | 'tools') => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const verovioOk = tools?.verovio.installed
  const museOk = tools?.musescore.installed
  const hasPdf = Boolean(result.score_pdf_url)
  const hasSvg = Boolean(result.score_svg_url || result.svg_url)
  const placeholder = result.score_renderer === 'placeholder'

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !hasSvg) return
    // Rough sync: scroll horizontally with playhead / duration estimate.
    const dur = Math.max(
      1,
      ...Object.values(result.tracks)
        .flat()
        .map((e) => e.offset),
    )
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll <= 0) return
    el.scrollLeft = (playhead / dur) * maxScroll
  }, [playhead, hasSvg, result.tracks])

  return (
    <div className="midi-score-pane">
      <h3>Score</h3>
      {hasSvg ? (
        <div className="score-view midi-score-scroll" ref={scrollRef}>
          <img
            src={result.score_svg_url || result.svg_url}
            alt="Rendered score"
            style={{ maxWidth: 'none', height: 160 }}
          />
          {placeholder && (
            <p className="muted">Placeholder engraving — install Verovio in Prefs → Tools for real SVG.</p>
          )}
        </div>
      ) : (
        <div className="gate">
          <div className="gate-title">No score SVG yet</div>
          <p className="gate-body">
            {verovioOk || museOk
              ? 'Re-run Transcribe to engrave MusicXML → SVG.'
              : 'Install Verovio (pip) or MuseScore in Prefs → Tools, then re-transcribe.'}
          </p>
        </div>
      )}
      <div className="export-links" style={{ marginTop: '0.5rem' }}>
        {hasPdf ? (
          <a href={result.score_pdf_url} download>
            Export PDF
          </a>
        ) : (
          <span className="muted">
            No PDF
            {!museOk
              ? ' — MuseScore not found (Verovio writes SVG only)'
              : ' — re-run Transcribe after MuseScore is available'}
            .
          </span>
        )}
        {result.musicxml_url && (
          <>
            {' · '}
            <a href={result.musicxml_url} download>
              MusicXML
            </a>
          </>
        )}
      </div>
      {!hasPdf && (
        <button type="button" className="ghost" style={{ marginTop: '0.35rem' }} onClick={() => onOpenPrefs('tools')}>
          Prefs → Tools
        </button>
      )}
    </div>
  )
}

function RollOptionsBar({
  options,
  setOptions,
  metronome,
  setMetronome,
  soundfontOk,
}: {
  options: RollOptions
  setOptions: (o: RollOptions) => void
  metronome: boolean
  setMetronome: (v: boolean) => void
  soundfontOk: boolean
}) {
  const toggle = (key: keyof RollOptions) =>
    setOptions({ ...options, [key]: !options[key] })

  return (
    <div className="row midi-roll-opts" style={{ flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
      {(
        [
          ['showKeyboard', 'Keyboard'],
          ['velocityHeight', 'Velocity height'],
          ['noteGlow', 'Note glow'],
          ['showGrid', 'Grid'],
          ['bloom', 'Bloom'],
          ['colorByTrack', 'Color by track'],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="field" style={{ flexDirection: 'row', gap: 6 }}>
          <input type="checkbox" checked={options[k]} onChange={() => toggle(k)} />
          <span>{label}</span>
        </label>
      ))}
      <button type="button" className={metronome ? 'active' : ''} onClick={() => setMetronome(!metronome)}>
        Metronome
      </button>
      {!soundfontOk && (
        <span className="muted">Soundfont: install GM SF2 in Prefs → Tools for sampled audition</span>
      )}
    </div>
  )
}

function TranscribeControls({
  running,
  onRun,
  onOpenPrefs,
}: {
  running: boolean
  onRun: () => void
  onOpenPrefs: (section?: 'models' | 'tools') => void
}) {
  const [quality, setQuality] = useLocalPref('neiro.tr.quality', 'standard')
  const [mode, setMode] = useLocalPref('neiro.tr.mode', 'auto')
  const [model, setModel] = useLocalPref('neiro.tr.model', '')
  const [members, setMembers] = useLocalJsonPref<string[]>('neiro.tr.members', [])
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({})
  const selected = TRANSCRIBE_MODES.find((m) => m.value === mode) || TRANSCRIBE_MODES[0]
  const selectedModel = TRANSCRIBE_MODELS.find((m) => m.value === model) || TRANSCRIBE_MODELS[0]
  const selectedQuality =
    TRANSCRIBE_QUALITY_PRESETS.find((q) => q.value === quality) || TRANSCRIBE_QUALITY_PRESETS[1]
  const ensembleMode = mode === 'ensemble' || model === 'tr-ensemble-default' || members.length >= 2
  const { file, analysisCorrections, startEngineJob, setTranscribeResult, jobForKind, cancelSessionJob } =
    useSession()
  const job = jobForKind('transcribe')

  useEffect(() => {
    let alive = true
    void fetchModels('transcribe')
      .then((list) => {
        if (!alive) return
        const map: Record<string, ModelStatus> = {}
        for (const m of list) map[m.id] = m
        setModelStatus(map)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const applyQuality = (value: string) => {
    setQuality(value)
    const preset = TRANSCRIBE_QUALITY_PRESETS.find((q) => q.value === value)
    if (!preset) return
    setMode(preset.mode)
    setModel(preset.model)
  }

  const toggleMember = (id: string) => {
    setMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const run = async () => {
    if (!file) return
    if (model === 'whisper-lyrics') {
      window.alert(
        'Whisper lyrics produces synced text, not MIDI. Pick a note decoder (or ensemble) for piano-roll transcription.',
      )
      return
    }
    // Auto-download weights when the selected model (or ensemble members) need them.
    const toDownload: string[] = []
    const consider = (id: string) => {
      if (!id) return
      const st = modelStatus[id]?.status
      if (st === 'needs-download') toDownload.push(id)
    }
    consider(model)
    if (ensembleMode) {
      for (const mid of members) consider(mid)
    }
    if (toDownload.length) {
      const dl = await startEngineJob({
        kind: 'download',
        label: `Download · ${toDownload.join(', ')}`,
        module: 'midi',
        startFn: () => startModelDownload({ model_ids: toDownload }),
      })
      if (dl?.status !== 'done') {
        return
      }
      // Refresh status after download
      try {
        const list = await fetchModels('transcribe')
        const map: Record<string, ModelStatus> = {}
        for (const m of list) map[m.id] = m
        setModelStatus(map)
      } catch {
        /* ignore */
      }
    }
    const useEnsemble = ensembleMode && (members.length >= 2 || model === 'tr-ensemble-default')
    const memberList = useEnsemble && members.length >= 2 ? members : undefined
    const done = await startEngineJob({
      kind: 'transcribe',
      label: useEnsemble
        ? `Transcribe · ensemble${memberList ? ` · ${memberList.length} members` : ''}`
        : `Transcribe · ${mode}${model ? ` · ${model}` : ''}`,
      module: 'midi',
      startFn: () =>
        startTranscribe(file.fileId, useEnsemble ? 'ensemble' : mode, model || undefined, {
          members: memberList,
          ensemble: useEnsemble && !memberList,
          corrections: analysisCorrections,
        }),
    })
    if (done?.status === 'done' && done.result) {
      setTranscribeResult(done.result as TranscribeResult)
    }
    onRun()
  }

  if (!file) return null
  const memberChoices = TRANSCRIBE_MODELS.filter((m) => m.ensembleMember)
  const installOnlyMembers = memberChoices.filter((m) => modelStatus[m.value]?.status === 'needs-install')
  const downloadPendingMembers = memberChoices.filter(
    (m) => modelStatus[m.value]?.status === 'needs-download',
  )
  const modelReady =
    !model ||
    modelStatus[model]?.status === 'ready' ||
    modelStatus[model]?.status === 'needs-download' ||
    modelStatus[model]?.available
  const modelSt = model ? modelStatus[model]?.status : undefined

  return (
    <>
      <p className="intent" style={{ marginBottom: '0.65rem' }}>
        NeuralNote-inspired flow: pick a quality preset, check model status, transcribe, then Edit or Practice.
        NeuralNote itself is not shipped — open models only.
      </p>

      <div className="row">
        <IntentField label="Quality" intent={selectedQuality.intent} htmlFor="tr-quality">
          <select
            id="tr-quality"
            value={quality}
            disabled={running}
            onChange={(e) => applyQuality(e.target.value)}
          >
            {TRANSCRIBE_QUALITY_PRESETS.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </IntentField>
        <IntentField label="Mode" intent={selected.intent} htmlFor="tr-mode">
          <select id="tr-mode" value={mode} disabled={running} onChange={(e) => setMode(e.target.value)}>
            {TRANSCRIBE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </IntentField>
        <IntentField label="Model" intent={selectedModel.intent} htmlFor="tr-model">
          <select
            id="tr-model"
            value={model}
            disabled={running}
            onChange={(e) => setModel(e.target.value)}
          >
            {TRANSCRIBE_MODELS.map((m) => {
              const st = m.value ? modelStatus[m.value]?.status : undefined
              return (
                <option key={m.value || 'default'} value={m.value}>
                  {m.label}
                  {statusLabel(st)}
                  {m.lyricsOnly ? ' — lyrics only' : ''}
                </option>
              )
            })}
          </select>
        </IntentField>
        <button type="button" className="primary" disabled={running} onClick={() => void run()}>
          Transcribe
        </button>
      </div>

      <div className="midi-model-status mono muted" role="status">
        Decoder:{' '}
        <strong>{selectedModel.label}</strong>
        {' · '}
        {model ? statusBadge(modelSt) : 'planner picks best installed'}
        {model && !modelReady && (
          <>
            {' · '}
            <button type="button" className="ghost" onClick={() => onOpenPrefs('models')}>
              Prefs → Models
            </button>
          </>
        )}
      </div>

      <details className="advanced-block" open={ensembleMode}>
        <summary>Ensemble members</summary>
        <div className="advanced-block-body">
          <IntentField
            label="Decoders"
            intent="Select two or more decoders for hybrid vote. Needs-download members auto-fetch on Transcribe; needs-install stay Prefs-linked."
          >
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
              {memberChoices.map((m) => {
                const st = modelStatus[m.value]?.status
                const installOnly = st === 'needs-install'
                return (
                  <label key={m.value} className="field" style={{ flexDirection: 'row', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={members.includes(m.value)}
                      disabled={running || installOnly}
                      onChange={() => toggleMember(m.value)}
                    />
                    <span>
                      {m.label}
                      {statusLabel(st)}
                      {installOnly ? ' — needs install' : st === 'needs-download' ? ' — will download' : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          </IntentField>
          {(installOnlyMembers.length > 0 || downloadPendingMembers.length > 0) && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              {installOnlyMembers.length > 0 && (
                <>
                  Needs install ({installOnlyMembers.map((m) => m.label).join(', ')}) —{' '}
                  <button type="button" className="ghost" onClick={() => onOpenPrefs('models')}>
                    Prefs → Models
                  </button>
                  .{' '}
                </>
              )}
              {downloadPendingMembers.length > 0 && (
                <>
                  Will auto-download on Transcribe ({downloadPendingMembers.map((m) => m.label).join(', ')}
                  ).
                </>
              )}
            </p>
          )}
        </div>
      </details>

      <PlanStrip
        kind="transcribe"
        fileId={file.fileId}
        mode={ensembleMode ? 'ensemble' : mode}
        model={model || undefined}
        members={members.length >= 2 ? members : undefined}
      />
      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />
    </>
  )
}

/** Unified MIDI Studio — absorbs Transcribe + Learn. */
export function MidiStudioModule() {
  const {
    file,
    transcribeResult,
    setTranscribeResult,
    practiceFocus,
    clearPracticeFocus,
    midiModeFocus,
    setMidiModeFocus,
    jobForKind,
    setModule,
  } = useSession()

  const [mode, setModeRaw] = useLocalPref('neiro.midi.mode', 'transcribe')
  const setMode = (m: MidiStudioMode) => setModeRaw(m)
  const modeTyped = (MODES.some((x) => x.id === mode) ? mode : 'transcribe') as MidiStudioMode
  const [rollOpts, setRollOpts] = useLocalJsonPref<RollOptions>(
    'neiro.midi.rollOpts',
    DEFAULT_ROLL_OPTIONS,
  )
  const [metronome, setMetronome] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [tools, setTools] = useState<ToolsStatus | null>(null)
  const [editTool, setEditTool] = useState<'select' | 'draw' | 'erase'>('select')
  const [selected, setSelected] = useState<{ track: string; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [velocity, setVelocity] = useState(100)
  const undoRef = useRef<UndoEntry[]>([])
  const redoRef = useRef<UndoEntry[]>([])

  const job = jobForKind('transcribe')
  const running = job?.status === 'running'
  const soundfontOk = Boolean(tools?.soundfont.installed)

  const goPrefs = (section: 'models' | 'tools' = 'models') => {
    openPrefs(section)
    setModule('preferences')
  }

  useEffect(() => {
    void fetchToolsStatus()
      .then(setTools)
      .catch(() => setTools(null))
  }, [mode])

  useEffect(() => {
    if (midiModeFocus) {
      setMode(midiModeFocus)
      setMidiModeFocus(null)
    }
  }, [midiModeFocus, setMidiModeFocus, setMode])

  useEffect(() => {
    if (!practiceFocus) return
    setMode('practice')
    const t = window.setTimeout(() => clearPracticeFocus(), 800)
    return () => window.clearTimeout(t)
  }, [practiceFocus, clearPracticeFocus, setMode])

  const pushUndo = (r: TranscribeResult) => {
    undoRef.current.push({ tracks: structuredClone(r.tracks), tempo_bpm: r.tempo_bpm })
    if (undoRef.current.length > 40) undoRef.current.shift()
    redoRef.current = []
  }

  const syncFromServer = async (
    op: Record<string, unknown>,
    snapshot?: TranscribeResult,
  ): Promise<boolean> => {
    const jobId = transcribeResult?.job_id
    if (!jobId || !transcribeResult) return false
    if (snapshot) pushUndo(snapshot)
    setBusy(true)
    try {
      const next = await editNotes(jobId, op)
      setTranscribeResult(applyTracks(transcribeResult, next.tracks, next.tempo_bpm))
      return true
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const undo = () => {
    if (!transcribeResult || !undoRef.current.length) return
    const prev = undoRef.current.pop()!
    redoRef.current.push({
      tracks: structuredClone(transcribeResult.tracks),
      tempo_bpm: transcribeResult.tempo_bpm,
    })
    setTranscribeResult(applyTracks(transcribeResult, prev.tracks, prev.tempo_bpm))
  }

  const redo = () => {
    if (!transcribeResult || !redoRef.current.length) return
    const next = redoRef.current.pop()!
    undoRef.current.push({
      tracks: structuredClone(transcribeResult.tracks),
      tempo_bpm: transcribeResult.tempo_bpm,
    })
    setTranscribeResult(applyTracks(transcribeResult, next.tracks, next.tempo_bpm))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modeTyped !== 'edit') return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!file) {
    return (
      <EmptyGate title="MIDI Studio">
        Import a file first, then transcribe to MIDI, edit the roll, engrave a score, or practice.
      </EmptyGate>
    )
  }

  const showRoll = modeTyped === 'roll' || modeTyped === 'roll-score' || modeTyped === 'edit' || modeTyped === 'transcribe'
  const interactive = modeTyped === 'edit'

  return (
    <div className="module-panel module-enter midi-studio">
      <ModuleHeader
        title="MIDI Studio"
        lede={
          <>
            Transcribe, piano roll, score, edit, and practice for <strong>{file.name}</strong>.
            Shortcut <kbd>8</kbd> jumps to Practice.
          </>
        }
      />

      <div className="midi-mode-tabs" role="tablist" aria-label="MIDI Studio modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={modeTyped === m.id}
            className={modeTyped === m.id ? 'active' : ''}
            title={m.hint}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modeTyped === 'transcribe' && (
        <TranscribeControls running={running} onRun={() => setMode('roll')} onOpenPrefs={goPrefs} />
      )}

      {modeTyped === 'practice' && <MidiPracticePanel focus={practiceFocus} />}

      {(modeTyped === 'roll' || modeTyped === 'roll-score' || modeTyped === 'edit') && !transcribeResult && (
        <div className="gate">
          <div className="gate-title">No MIDI yet</div>
          <p className="gate-body">Run Transcribe to fill the piano roll.</p>
          <button type="button" onClick={() => setMode('transcribe')}>
            Go to Transcribe
          </button>
        </div>
      )}

      {transcribeResult && showRoll && (
        <>
          {modeTyped !== 'transcribe' && (
            <RollOptionsBar
              options={rollOpts}
              setOptions={setRollOpts}
              metronome={metronome}
              setMetronome={setMetronome}
              soundfontOk={soundfontOk}
            />
          )}

          {modeTyped === 'edit' && (
            <div className="row" style={{ marginBottom: '0.65rem', flexWrap: 'wrap' }}>
              {(['select', 'draw', 'erase'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={editTool === t ? 'active' : ''}
                  onClick={() => setEditTool(t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
              <button type="button" disabled={busy || !undoRef.current.length} onClick={undo}>
                Undo
              </button>
              <button type="button" disabled={busy || !redoRef.current.length} onClick={redo}>
                Redo
              </button>
              <button
                type="button"
                disabled={busy || !transcribeResult.job_id}
                onClick={() =>
                  void syncFromServer(
                    { op: 'quantize', division: 4, strength: 1 },
                    transcribeResult,
                  )
                }
              >
                Quantize 1/16
              </button>
              <button
                type="button"
                disabled={busy || !transcribeResult.job_id}
                onClick={() =>
                  void syncFromServer(
                    { op: 'quantize', division: 4, strength: 0.5 },
                    transcribeResult,
                  )
                }
                title="Partial snap — preserves groove"
              >
                Quantize soft
              </button>
              <label className="field" style={{ minWidth: 8 + 'rem' }}>
                Velocity
                <input
                  type="range"
                  min={1}
                  max={127}
                  value={velocity}
                  onChange={(e) => setVelocity(Number(e.target.value))}
                  onMouseUp={() => {
                    if (!selected || !transcribeResult) return
                    void syncFromServer(
                      {
                        op: 'update',
                        track: selected.track,
                        index: selected.index,
                        velocity,
                      },
                      transcribeResult,
                    )
                  }}
                />
              </label>
              <div className="muted">
                Lanes:{' '}
                {Object.keys(transcribeResult.tracks).map((t) => (
                  <span key={t} style={{ color: stemColor(t), marginRight: 8 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <PianoRollView
            result={transcribeResult}
            options={
              modeTyped === 'transcribe'
                ? { ...DEFAULT_ROLL_OPTIONS, bloom: rollOpts.bloom }
                : rollOpts
            }
            interactive={interactive}
            tool={editTool}
            selected={selected}
            onSelect={setSelected}
            soundfontEnabled={soundfontOk}
            soundfontUrls={tools?.soundfont.urls}
            metronomeOn={metronome}
            playheadSec={playhead}
            onPlayhead={setPlayhead}
            onDraw={(note) => {
              void syncFromServer(
                {
                  op: 'add',
                  track: note.track,
                  onset: note.onset,
                  offset: note.offset,
                  pitch: note.pitch,
                  velocity: note.velocity,
                },
                transcribeResult,
              )
            }}
            onErase={(sel) => {
              void syncFromServer(
                { op: 'delete', track: sel.track, index: sel.index },
                transcribeResult,
              )
              setSelected(null)
            }}
            onMoveResize={(sel, patch) => {
              void syncFromServer(
                { op: 'update', track: sel.track, index: sel.index, ...patch },
                transcribeResult,
              )
            }}
          />

          <div className="meta-block" style={{ marginTop: '0.75rem' }}>
            {transcribeResult.event_count} notes · {Math.round(transcribeResult.tempo_bpm)} BPM ·{' '}
            {transcribeResult.model}
            <div className="export-links" style={{ marginTop: '0.45rem' }}>
              <a href={transcribeResult.midi_url} download>
                MIDI
              </a>
              {transcribeResult.musicxml_url && (
                <>
                  {' · '}
                  <a href={transcribeResult.musicxml_url} download>
                    MusicXML
                  </a>
                </>
              )}
              {transcribeResult.score_pdf_url ? (
                <>
                  {' · '}
                  <a href={transcribeResult.score_pdf_url} download>
                    PDF
                  </a>
                </>
              ) : (
                <>
                  {' · '}
                  <span className="muted">PDF unavailable</span>
                  {' · '}
                  <button type="button" className="ghost" onClick={() => goPrefs('tools')}>
                    Prefs → Tools
                  </button>
                </>
              )}
              {transcribeResult.provenance_url && (
                <>
                  {' · '}
                  <a href={transcribeResult.provenance_url} download>
                    Provenance
                  </a>
                </>
              )}
            </div>
            {transcribeResult.notes && transcribeResult.notes.length > 0 && (
              <ul className="intent plan-notes" style={{ marginTop: '0.45rem' }}>
                {transcribeResult.notes.slice(0, 4).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>

          {modeTyped === 'roll-score' && (
            <ScorePane
              result={transcribeResult}
              playhead={playhead}
              tools={tools}
              onOpenPrefs={goPrefs}
            />
          )}
        </>
      )}

      {modeTyped === 'transcribe' && transcribeResult && (
        <div style={{ marginTop: '1rem' }}>
          <PianoRollView
            result={transcribeResult}
            options={{ ...DEFAULT_ROLL_OPTIONS, bloom: rollOpts.bloom }}
            soundfontEnabled={soundfontOk}
            soundfontUrls={tools?.soundfont.urls}
            playheadSec={playhead}
            onPlayhead={setPlayhead}
          />
          <div className="meta-block" style={{ marginTop: '0.65rem' }}>
            <div className="export-links">
              <a href={transcribeResult.midi_url} download>
                MIDI
              </a>
              {transcribeResult.musicxml_url && (
                <>
                  {' · '}
                  <a href={transcribeResult.musicxml_url} download>
                    MusicXML
                  </a>
                </>
              )}
              {transcribeResult.score_pdf_url ? (
                <>
                  {' · '}
                  <a href={transcribeResult.score_pdf_url} download>
                    PDF
                  </a>
                </>
              ) : (
                <>
                  {' · '}
                  <span className="muted">No PDF — MuseScore in Prefs → Tools</span>
                </>
              )}
              {transcribeResult.provenance_url && (
                <>
                  {' · '}
                  <a href={transcribeResult.provenance_url} download>
                    Provenance
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="primary" onClick={() => setMode('edit')}>
              Open in Edit
            </button>
            <button type="button" onClick={() => setMode('practice')}>
              Open in Practice
            </button>
            <button type="button" onClick={() => setMode('roll-score')}>
              Roll + score
            </button>
            <button type="button" className="ghost" onClick={() => goPrefs('models')}>
              Prefs · Models
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
