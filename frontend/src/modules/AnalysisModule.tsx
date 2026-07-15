import { useMemo, useState } from 'react'
import { useSession } from '../state/session'
import { fmtTime } from '../constants/options'
import './modules.css'

function flagWhy(note: string): string {
  const n = note.toLowerCase()
  if (n.includes('clip')) return 'Clipping limits headroom and can distort restorations.'
  if (n.includes('hum') || n.includes('50 hz') || n.includes('60 hz'))
    return 'Mains hum is removable with the dehum chain in Restore.'
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

/** User corrections overlay — does not mutate the source analysis report bytes. */
export interface AnalysisCorrections {
  instruments?: string[]
  key?: string
  bpm?: number
  confirmedTentative?: string[]
  dismissed?: string[]
}

export function AnalysisModule() {
  const { file, setFile, setModule, openInStudio, workspaceMode } = useSession()
  const [corrections, setCorrections] = useState<AnalysisCorrections>({})
  const [draftKey, setDraftKey] = useState('')
  const [draftBpm, setDraftBpm] = useState('')
  const [extraInstrument, setExtraInstrument] = useState('piano')

  const asserted =
    file?.report.instruments?.filter((h) => h.status === 'asserted').map((h) => h.instrument) ||
    []
  const tentative =
    file?.report.instruments?.filter((h) => h.status === 'tentative').map((h) => h.instrument) ||
    []

  const effectiveInstruments = useMemo(() => {
    if (corrections.instruments?.length) return corrections.instruments
    const base = [...asserted]
    for (const t of corrections.confirmedTentative || []) {
      if (!base.includes(t)) base.push(t)
    }
    return base.filter((i) => !(corrections.dismissed || []).includes(i))
  }, [corrections, asserted])

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Analysis</h2>
        <p className="muted">Load a file in Import to see the report.</p>
      </div>
    )
  }

  const r = file.report
  let instruments = effectiveInstruments.length
    ? `Detected: ${effectiveInstruments.join(', ')}`
    : ''
  const remainingTentative = tentative.filter(
    (t) =>
      !(corrections.confirmedTentative || []).includes(t) &&
      !(corrections.dismissed || []).includes(t),
  )
  if (remainingTentative.length) {
    instruments += `${instruments ? '. ' : ''}possibly: ${remainingTentative.join(', ')}`
  }

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
      corrections.bpm
        ? `~${corrections.bpm} BPM (corrected)`
        : r.estimated_bpm
          ? `~${r.estimated_bpm} BPM`
          : 'not detected',
    ],
    [
      'Key',
      corrections.key
        ? `${corrections.key} (corrected)`
        : r.estimated_key || 'not detected',
    ],
    [
      'Bandwidth',
      r.bandwidth_hz ? `${(r.bandwidth_hz / 1000).toFixed(1)} kHz` : '—',
    ],
  ]
  if (instruments) rows.push(['Instruments', instruments])

  const applyCorrectionsToSession = () => {
    const note = `user_corrections:${JSON.stringify(corrections)}`
    const notes = (file.report.notes || []).filter((n) => !n.startsWith('user_corrections:'))
    setFile({
      ...file,
      report: { ...file.report, notes: [...notes, note] },
    })
  }

  return (
    <div className="module-panel">
      <h2>Analysis</h2>
      <p className="lede">
        Report for <strong>{file.name}</strong>. Corrections change routing for this session; they
        do not rewrite the source analysis artifact.
      </p>

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

      {remainingTentative.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">Confirm tentative detections:</span>
          {remainingTentative.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() =>
                setCorrections((c) => ({
                  ...c,
                  confirmedTentative: [...(c.confirmedTentative || []), t],
                }))
              }
            >
              Confirm {t}
            </button>
          ))}
        </div>
      )}

      {(workspaceMode === 'advanced' || asserted.length > 0) && (
        <div className="advanced-block" style={{ marginTop: 16 }}>
          <h3>Corrections</h3>
          <div className="row">
            <label className="field">
              Key override
              <input
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder={r.estimated_key || 'e.g. F minor'}
              />
            </label>
            <button
              type="button"
              onClick={() => setCorrections((c) => ({ ...c, key: draftKey || undefined }))}
            >
              Apply key
            </button>
            <label className="field">
              BPM override
              <input
                value={draftBpm}
                onChange={(e) => setDraftBpm(e.target.value)}
                placeholder={r.estimated_bpm ? String(r.estimated_bpm) : '120'}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setCorrections((c) => ({
                  ...c,
                  bpm: draftBpm ? Number(draftBpm) : undefined,
                }))
              }
            >
              Apply BPM
            </button>
          </div>
          <div className="row">
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
            <button
              type="button"
              onClick={() =>
                setCorrections((c) => ({
                  ...c,
                  instruments: [
                    ...new Set([...(c.instruments || effectiveInstruments), extraInstrument]),
                  ],
                }))
              }
            >
              Add
            </button>
            <button
              type="button"
              className="primary"
              onClick={applyCorrectionsToSession}
              title="Persist corrections into the session for planner routing"
            >
              Use corrections for routing
            </button>
            <button type="button" onClick={() => setCorrections({})}>
              Reset corrections
            </button>
          </div>
        </div>
      )}

      <audio controls src={file.audioUrl} style={{ width: '100%', marginTop: 16 }} />

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
