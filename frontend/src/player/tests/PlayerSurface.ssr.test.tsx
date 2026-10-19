import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerSurface } from '../PlayerSurface'
import type { AnalysisReport } from '../../api/types'

/**
 * Server-rendered player surface checks. Effects (AudioContext/worklet) do not run
 * in SSR, so this proves the markup, labels and state wiring without a browser;
 * audible behaviour is covered by the Node DSP tests and the owner listening pass.
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
  chords: [
    { chord: 'Am', start: 0, end: 8, confidence: 0.7 },
    { chord: 'F', start: 8, end: 16, confidence: 0.6 },
  ],
  beats: [
    { time: 0, downbeat: true },
    { time: 0.5, downbeat: false },
  ],
  chord_reliable: true,
  chord_method: 'heuristic-chord-timeline',
  meter: '4/4',
  tempo_confidence: 0.5,
}

function render(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <PlayerSurface
      src="/files/edits/demo/tone.wav"
      fileId="ui-test"
      title="Tone"
      duration={120}
      bpm={120}
      notes={[
        { onset: 1, pitch: 60 },
        { onset: 2, pitch: 62 },
      ]}
      analysis={analysis}
      {...extra}
    />,
  )
}

describe('PlayerSurface markup', () => {
  it('renders transport, real-time controls and honest labels', () => {
    const html = render()
    expect(html).toContain('Tone')
    expect(html).toContain('phase-vocoder preview')
    expect(html).toContain('Transpose')
    expect(html).toContain('Fine pitch (cents)')
    expect(html).toContain('Speed')
    expect(html).toContain('Formant')
    expect(html).toContain('Vocal reducer')
    expect(html).toContain('Count-in')
    expect(html).toContain('Low latency (formant off)')
    expect(html).toContain('A4 440.00 Hz')
    expect(html).toContain('aria-valuetext="0 semitones"')
    expect(html).toContain('aria-valuetext="100 percent"')
  })

  it('renders A-B, markers, clips, scenes, MIDI and shortcut surfaces', () => {
    const html = render()
    expect(html).toMatch(/A.B loop/)
    expect(html).toContain('Set A')
    expect(html).toContain('Markers')
    expect(html).toContain('Clips')
    expect(html).toContain('Scenes')
    expect(html).toContain('MIDI learn')
    expect(html).toContain('Keyboard shortcuts')
  })

  it('renders the analysis overlay when a report is supplied', () => {
    const html = render()
    expect(html).toContain('Am')
    expect(html).toContain('F')
    expect(html).toContain('role="img"')
    expect(html).toContain('2 beats')
  })

  it('omits the analysis overlay without a report', () => {
    const html = render({ analysis: null })
    expect(html).not.toContain('player-analysis')
    expect(html).toContain('phase-vocoder preview')
  })

  it('renders without a duration or notes (gate state)', () => {
    const html = renderToStaticMarkup(
      <PlayerSurface src="/files/edits/demo/tone.wav" fileId="empty" />,
    )
    expect(html).toContain('Play')
    expect(html).toContain('Loading audio')
  })
})
