// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import { PlayerSurface } from '../PlayerSurface'
import type { AnalysisReport } from '../../api/types'

/**
 * Automated accessibility smoke for the player surface.
 *
 * Axe runs against the server-rendered DOM in jsdom. Layout-dependent checks
 * (colour contrast, target size) cannot run headlessly, and this is not a WCAG
 * certification: it catches missing names/roles/labels. The manual screen-reader
 * and contrast pass remains owner-run.
 */

const analysis: AnalysisReport = {
  duration_seconds: 120,
  sample_rate: 44100,
  channels: 2,
  is_effectively_mono: false,
  integrated_lufs: -14,
  peak_dbfs: -1,
  estimated_bpm: 120,
  estimated_key: 'A minor',
  chords: [{ chord: 'Am', start: 0, end: 8, confidence: 0.7 }],
  beats: [{ time: 0, downbeat: true }],
  chord_reliable: true,
  chord_method: 'heuristic-chord-timeline',
  meter: '4/4',
  tempo_confidence: 0.5,
}

describe('PlayerSurface accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const html = renderToStaticMarkup(
      <PlayerSurface
        src="/files/edits/demo/tone.wav"
        fileId="axe-test"
        title="Tone"
        duration={120}
        bpm={120}
        notes={[{ onset: 1, pitch: 60 }]}
        analysis={analysis}
      />,
    )
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    try {
      const results = await axe.run(container, {
        resultTypes: ['violations'],
      })
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      )
      expect({
        violations: serious.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
      }).toEqual({ violations: [] })
    } finally {
      container.remove()
    }
  })
})
