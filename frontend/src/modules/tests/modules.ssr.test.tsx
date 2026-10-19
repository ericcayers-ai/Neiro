import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '../../i18n'
import { SessionProvider } from '../../state/session'
import { ImportModule } from '../ImportModule'
import { LibraryModule } from '../LibraryModule'
import { RestoreModule } from '../RestoreModule'
import { SeparateModule } from '../SeparateModule'
import { PreferencesModule } from '../PreferencesModule'
import { AnalysisLanes } from '../AnalysisLanes'

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider>
      <SessionProvider>{node}</SessionProvider>
    </I18nProvider>,
  )
}

describe('module shells render through the catalogue', () => {
  it('renders the Library header and empty state', () => {
    const html = render(<LibraryModule />)
    expect(html).toContain('Local songs, per-song notes')
    expect(html).toContain('No songs yet')
    expect(html).toContain('Add current file')
    expect(html).toContain('Resume last')
  })

  it('renders analysis lanes with key/chord/beat toggles', () => {
    const html = renderToStaticMarkup(
      <AnalysisLanes
        report={{
          duration_seconds: 60,
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
          chord_method: 'heuristic',
          meter: '4/4',
          tempo_confidence: 0.5,
        }}
      />,
    )
    expect(html).toContain('Key &amp; tempo')
    expect(html).toContain('Chords')
    expect(html).toContain('Beats')
  })

  it('renders the Preferences sections through the catalogue', () => {
    const html = render(<PreferencesModule />)
    expect(html).toContain('Compute &amp; storage')
    expect(html).toContain('No telemetry by default')
  })

  it('renders the Separate empty gate', () => {
    const html = render(<SeparateModule />)
    expect(html).toContain('pick a stem preset')
  })

  it('renders the Restore empty gate', () => {
    const html = render(<RestoreModule />)
    expect(html).toContain('Import a track first')
  })

  it('renders the Import dropzone and URL fetch', () => {
    const html = render(<ImportModule />)
    expect(html).toContain('Drop audio here')
    expect(html).toContain('Fetch URL')
    expect(html).toContain('Open local files')
  })
})
