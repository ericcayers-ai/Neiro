import { useEffect, useMemo, useState } from 'react'
import type { AnalysisCorrectionsPayload, VocalConditions } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { ModuleHeader } from '../components/ModuleHeader'
import { fmtTime } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

function flagWhy(note: string): string {
  const n = note.toLowerCase()
  if (n.includes('clip')) return 'Clipping limits headroom and can distort restorations.'
  if (n.includes('hum') || n.includes('50 hz') || n.includes('60 hz'))
    return 'Mains hum is removable with the dehum chain in Restore.'
  if (n.includes('echo') || n.includes('delay'))
    return 'Stem-aware delay flags feed Restore dereverb suggestions.'
  if (n.includes('reverb')) return 'Reverb complicates separation and transcription accuracy.'
  if (n.includes('noise')) return 'Noise may need denoise before separation or transcription.'
  if (n.includes('bandwidth') || n.includes('band-limited'))
    return 'Limited bandwidth may benefit from super-resolution if AudioSR is installed.'
  if (n.includes('mono')) return 'Effectively mono stereo often means mid-side separation will be weak.'
  return 'Flagged by analysis — check Restore or adjust separation expectations.'
}

const INSTRUMENT_CHOICES = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'keys',
  'strings',
  'synth',
  'other',
]

/** Draft editor state before Apply — does not mutate the source analysis report. */
export interface AnalysisCorrectionsDraft {
  instruments: string[]
  key: string
  bpm: string
  dismissed: string[]
}

function emptyDraft(): AnalysisCorrectionsDraft {
  return { instruments: [], key: '', bpm: '', dismissed: [] }
}

function draftFromReport(
  asserted: string[],
  applied: AnalysisCorrectionsPayload | null,
): AnalysisCorrectionsDraft {
  const o = applied?.overrides || {}
  const instrumentsFromOverride = Array.isArray(o.instruments)
    ? (o.instruments as { instrument?: string }[])
        .map((h) => (typeof h === 'string' ? h : h.instrument || ''))
        .filter(Boolean)
    : []
  return {
    instruments: instrumentsFromOverride.length ? instrumentsFromOverride : [...asserted],
    key: typeof o.estimated_key === 'string' ? o.estimated_key : '',
    bpm:
      typeof o.estimated_bpm === 'number' && Number.isFinite(o.estimated_bpm)
        ? String(o.estimated_bpm)
        : '',
    dismissed: [],
  }
}

function toPayload(draft: AnalysisCorrectionsDraft): AnalysisCorrectionsPayload {
  const overrides: Record<string, unknown> = {}
  const reasons: Record<string, string> = {}
  const instruments = draft.instruments.filter((i) => !draft.dismissed.includes(i))
  overrides.instruments = instruments.map((instrument) => ({
    instrument,
    confidence: 1,
    status: 'asserted',
  }))
  reasons.instruments = 'user correction'
  if (draft.key.trim()) {
    overrides.estimated_key = draft.key.trim()
    reasons.estimated_key = 'user correction'
  }
  const bpm = Number(draft.bpm)
  if (draft.bpm.trim() && Number.isFinite(bpm) && bpm > 0) {
    overrides.estimated_bpm = bpm
    reasons.estimated_bpm = 'user correction'
  }
  return { overrides, reasons }
}

function formatEchoRow(vc: VocalConditions | undefined): string | null {
  if (!vc?.echo_delay_s) return null
  const ms = Math.round(vc.echo_delay_s * 1000)
  const conf =
    typeof vc.echo_confidence === 'number' ? ` · confidence ${Math.round(vc.echo_confidence * 100)}%` : ''
  const preview = vc.echo_based_on_preview_split ? ' · based on preview split' : ''
  const stemParts: string[] = []
  if (vc.stem_echo) {
    for (const [name, hit] of Object.entries(vc.stem_echo)) {
      if (hit?.delay_s != null) {
        stemParts.push(
          `${name} ${Math.round(hit.delay_s * 1000)} ms (${Math.round((hit.confidence || 0) * 100)}%)`,
        )
      }
    }
  }
  const stems = stemParts.length ? ` · stems: ${stemParts.join(', ')}` : ''
  return `~${ms} ms${conf}${preview}${stems}`
}

export function AnalysisModule() {
  const {
    file,
    setFile,
    setModule,
    openInStudio,
    analysisCorrections,
    setAnalysisCorrections,
  } = useSession()
  const [draft, setDraft] = useState<AnalysisCorrectionsDraft>(emptyDraft())
  const [extraInstrument, setExtraInstrument] = useState('piano')
  const [appliedNote, setAppliedNote] = useState(false)

  const asserted =
    file?.report.instruments?.filter((h) => h.status === 'asserted').map((h) => h.instrument) ||
    []
  const tentative =
    file?.report.instruments?.filter((h) => h.status === 'tentative').map((h) => h.instrument) ||
    []

  useEffect(() => {
    if (!file) {
      setDraft(emptyDraft())
      setAppliedNote(false)
      return
    }
    setDraft(draftFromReport(asserted, analysisCorrections))
    setAppliedNote(Boolean(analysisCorrections && Object.keys(analysisCorrections.overrides).length))
    // Re-seed when the file or applied overlay changes; asserted is derived from file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.fileId, analysisCorrections])

  const effectiveInstruments = useMemo(
    () => draft.instruments.filter((i) => !draft.dismissed.includes(i)),
    [draft],
  )

  if (!file) {
    return (
      <EmptyGate title="Analysis">
        Load a file in Import to see loudness, tempo, key, and detected conditions.
      </EmptyGate>
    )
  }

  const r = file.report
  const echoRow = formatEchoRow(r.vocal_conditions)
  const displayKey =
    (analysisCorrections?.overrides.estimated_key as string | undefined) ||
    draft.key ||
    r.estimated_key
  const displayBpm =
    (analysisCorrections?.overrides.estimated_bpm as number | undefined) ||
    (draft.bpm ? Number(draft.bpm) : undefined) ||
    r.estimated_bpm

  const rows: [string, string][] = [
    [
      'Duration',
      `${fmtTime(r.duration_seconds)} · ${r.sample_rate} Hz · ${
        r.channels === 1
          ? 'mono'
          : r.is_effectively_mono
            ? 'stereo (effectively mono)'
            : 'stereo'
      }`,
    ],
    [
      'Loudness',
      `${r.integrated_lufs ?? '—'} LUFS · peak ${r.peak_dbfs ?? '—'} dBFS`,
    ],
    [
      'Tempo',
      displayBpm
        ? `~${displayBpm} BPM${analysisCorrections?.overrides.estimated_bpm != null ? ' (corrected)' : ''}`
        : 'not detected',
    ],
    [
      'Key',
      displayKey
        ? `${displayKey}${analysisCorrections?.overrides.estimated_key ? ' (corrected)' : ''}`
        : 'not detected',
    ],
    [
      'Bandwidth',
      r.bandwidth_hz ? `${(r.bandwidth_hz / 1000).toFixed(1)} kHz` : '—',
    ],
  ]
  if (effectiveInstruments.length) {
    rows.push(['Instruments', `Detected: ${effectiveInstruments.join(', ')}`])
  }
  if (echoRow) rows.push(['Echo / delay', echoRow])

  const remainingTentative = tentative.filter(
    (t) => !effectiveInstruments.includes(t) && !draft.dismissed.includes(t),
  )

  const applyCorrections = () => {
    const payload = toPayload(draft)
    setAnalysisCorrections(payload)
    const note = `user_corrections:${JSON.stringify(payload)}`
    const notes = (file.report.notes || []).filter((n) => !n.startsWith('user_corrections:'))
    setFile({
      ...file,
      report: { ...file.report, notes: [...notes, note] },
    })
    setAppliedNote(true)
  }

  const resetToAnalysis = () => {
    setAnalysisCorrections(null)
    setDraft(draftFromReport(asserted, null))
    const notes = (file.report.notes || []).filter((n) => !n.startsWith('user_corrections:'))
    setFile({ ...file, report: { ...file.report, notes } })
    setAppliedNote(false)
  }

  const toggleDismiss = (name: string) => {
    setDraft((d) => {
      const dismissed = d.dismissed.includes(name)
        ? d.dismissed.filter((x) => x !== name)
        : [...d.dismissed, name]
      return { ...d, dismissed }
    })
  }

  const addInstrument = (name: string) => {
    setDraft((d) => ({
      ...d,
      instruments: d.instruments.includes(name) ? d.instruments : [...d.instruments, name],
      dismissed: d.dismissed.filter((x) => x !== name),
    }))
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title="Analysis"
        lede={
          <>
            Report for <strong>{file.name}</strong>. Corrections change routing for this session —
            they do not rewrite the source artifact.
          </>
        }
      />

      <table className="report-table">
        <caption className="sr-only">Analysis summary</caption>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(r.notes || []).filter((n) => !n.startsWith('user_corrections:')).length > 0 && (
        <div className="flags">
          {(r.notes || [])
            .filter((n) => !n.startsWith('user_corrections:'))
            .map((n) => (
              <div key={n} className="flag">
                <div className="flag-note">{n}</div>
                <div className="intent">{flagWhy(n)}</div>
              </div>
            ))}
        </div>
      )}

      <div className="corrections-card">
        <div className="corrections-card-head">
          <h3>Corrections</h3>
          {appliedNote && <span className="corrections-applied">Applied for routing</span>}
        </div>
        <p className="intent" style={{ marginTop: 0 }}>
          Add or dismiss instruments, set key/BPM, then Apply so Separate and Transcribe planners
          can read the overlay.
        </p>

        <div className="chip-row" role="group" aria-label="Instrument corrections">
          {effectiveInstruments.map((name) => (
            <button
              key={name}
              type="button"
              className="chip chip-on"
              onClick={() => toggleDismiss(name)}
              title="Dismiss this instrument"
            >
              {name} ×
            </button>
          ))}
          {draft.dismissed.map((name) => (
            <button
              key={`dismissed-${name}`}
              type="button"
              className="chip chip-off"
              onClick={() => toggleDismiss(name)}
              title="Restore this instrument"
            >
              {name} (dismissed)
            </button>
          ))}
          {remainingTentative.map((t) => (
            <button
              key={`tent-${t}`}
              type="button"
              className="chip"
              onClick={() => addInstrument(t)}
              title="Confirm tentative detection"
            >
              + {t}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <label className="field">
            Add instrument
            <select
              value={extraInstrument}
              onChange={(e) => setExtraInstrument(e.target.value)}
            >
              {INSTRUMENT_CHOICES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => addInstrument(extraInstrument)}>
            Add
          </button>
          <label className="field">
            Key
            <input
              value={draft.key}
              onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
              placeholder={r.estimated_key || 'e.g. F minor'}
            />
          </label>
          <label className="field">
            BPM
            <input
              value={draft.bpm}
              onChange={(e) => setDraft((d) => ({ ...d, bpm: e.target.value }))}
              placeholder={r.estimated_bpm ? String(Math.round(r.estimated_bpm)) : '120'}
            />
          </label>
        </div>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="primary"
            onClick={applyCorrections}
            title="Persist corrections into the session for planner routing"
          >
            Apply
          </button>
          <button type="button" onClick={resetToAnalysis} title="Clear overrides and restore analysis">
            Reset to analysis
          </button>
        </div>
      </div>

      <audio controls src={file.audioUrl} style={{ width: '100%', marginTop: '1rem' }} />

      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="primary"
          onClick={() => openInStudio(file.fileId, file.audioUrl, file.name)}
          title="Open this file in Studio"
        >
          Open in Studio
        </button>
        <button type="button" onClick={() => setModule('separate')}>
          Separate
        </button>
        <button type="button" onClick={() => setModule('restore')}>
          Restore
        </button>
        <button type="button" onClick={() => setModule('transcribe')}>
          Transcribe
        </button>
      </div>
    </div>
  )
}
