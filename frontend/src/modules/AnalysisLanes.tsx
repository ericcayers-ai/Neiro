import { useEffect, useState } from 'react'

import type { AnalysisReport } from '../api/types'

interface Props {
  report: AnalysisReport
}

interface LaneVisibility {
  key: boolean
  chords: boolean
  beats: boolean
}

const LANES_KEY = 'neiro.analysis.lanes'

function readLanes(): LaneVisibility {
  try {
    const raw = localStorage.getItem(LANES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LaneVisibility>
      return {
        key: parsed.key !== false,
        chords: parsed.chords !== false,
        beats: parsed.beats !== false,
      }
    }
  } catch {
    /* default */
  }
  return { key: true, chords: true, beats: true }
}

/**
 * Chord and beat lanes for the Analysis view.
 *
 * The report says `chord_reliable: false` when the heuristic cannot find a clear
 * harmony; this view then shows "no reliable result" instead of a confident label.
 * Beat downbeats carry the 4/4 assumption in their tooltip.
 */
export function AnalysisLanes({ report }: Props) {
  const duration = Math.max(0.001, report.duration_seconds)
  const chords = report.chords ?? []
  const beats = report.beats ?? []
  const reliable = report.chord_reliable === true
  const [lanes, setLanes] = useState<LaneVisibility>(readLanes)

  useEffect(() => {
    try {
      localStorage.setItem(LANES_KEY, JSON.stringify(lanes))
    } catch {
      /* ignore */
    }
  }, [lanes])

  return (
    <section className="analysis-lanes" aria-label="Analysis timeline">
      <div className="analysis-lane-head" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Timeline</h3>
        <span className="intent">Show:</span>
        <label className="intent">
          <input
            type="checkbox"
            checked={lanes.key}
            onChange={(event) => setLanes({ ...lanes, key: event.target.checked })}
          />{' '}
          Key &amp; tempo
        </label>
        <label className="intent">
          <input
            type="checkbox"
            checked={lanes.chords}
            onChange={(event) => setLanes({ ...lanes, chords: event.target.checked })}
          />{' '}
          Chords
        </label>
        <label className="intent">
          <input
            type="checkbox"
            checked={lanes.beats}
            onChange={(event) => setLanes({ ...lanes, beats: event.target.checked })}
          />{' '}
          Beats
        </label>
      </div>

      {lanes.key && (
        <div className="analysis-lane" data-lane="key">
          <div className="analysis-lane-head">
            <span>Key &amp; tempo</span>
            <span className="intent">
              {report.estimated_key || 'unknown key'} ·{' '}
              {report.estimated_bpm ? `${Math.round(report.estimated_bpm)} BPM` : 'unknown tempo'}
              {report.meter ? ` · ${report.meter}` : ''}
            </span>
          </div>
        </div>
      )}

      {lanes.chords && (
      <div className="analysis-lane">
        <div className="analysis-lane-head">
          <span>Chords</span>
          <span className="intent">
            {report.chord_method || 'heuristic'} ·{' '}
            {reliable ? `${chords.length} segments` : 'no reliable result'}
          </span>
        </div>
        {reliable ? (
          <div className="chord-lane" role="img" aria-label={chords.map((c) => `${c.chord} ${c.start}-${c.end}s`).join('; ')}>
            {chords.map((chord, index) => {
              const left = (Math.max(0, chord.start) / duration) * 100
              const width = Math.max(0.6, ((chord.end - chord.start) / duration) * 100)
              return (
                <span
                  key={`${chord.chord}-${index}-${chord.start}`}
                  className="chord-block"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${chord.chord} · ${Math.round(chord.confidence * 100)}% confidence`}
                >
                  {chord.chord}
                </span>
              )
            })}
          </div>
        ) : (
          <p className="intent">
            No reliable chord result — the clean-room heuristic needs clearer harmony or a
            chord model installed in Prefs.
          </p>
        )}
      </div>
      )}

      {lanes.beats && (
      <div className="analysis-lane">
        <div className="analysis-lane-head">
          <span>Beats</span>
          <span className="intent">
            {beats.length} beats · meter {report.meter || '—'}
            {report.tempo_confidence != null
              ? ` · tempo confidence ${Math.round(report.tempo_confidence * 100)}%`
              : ''}
          </span>
        </div>
        {beats.length > 0 ? (
          <div className="beat-lane" role="img" aria-label={`${beats.length} beats, meter ${report.meter || 'unknown'}`}>
            {beats.map((beat, index) => (
              <span
                key={`${beat.time}-${index}`}
                className={`beat-tick${beat.downbeat ? ' is-downbeat' : ''}`}
                style={{ left: `${(beat.time / duration) * 100}%` }}
                title={`${beat.time.toFixed(2)}s${beat.downbeat ? ' · downbeat (4/4 assumption)' : ''}`}
              />
            ))}
          </div>
        ) : (
          <p className="intent">
            No reliable beat grid — the onset-flux heuristic needs clearer rhythmic attacks.
          </p>
        )}
      </div>
      )}
    </section>
  )
}
