import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '../../i18n'
import { EN, missingKeys, translate, type Catalogue } from '../../i18n/translate'
import { SessionProvider } from '../../state/session'
import { PreferencesModule } from '../PreferencesModule'

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider>
      <SessionProvider>{node}</SessionProvider>
    </I18nProvider>,
  )
}

/** Every catalogue key the Preferences module body resolves. */
const PREFERENCES_KEYS = [
  'prefs.title',
  'prefs.lede',
  'prefs.interface',
  'prefs.theme',
  'prefs.themeIntent',
  'prefs.themeDark',
  'prefs.themeLight',
  'prefs.themeHigh',
  'prefs.density',
  'prefs.densityIntent',
  'prefs.densityComfortable',
  'prefs.densityCompact',
  'prefs.fontScale',
  'prefs.fontScaleIntent',
  'prefs.motion',
  'prefs.motionIntent',
  'prefs.motionSystem',
  'prefs.motionReduce',
  'prefs.motionNoPreference',
  'prefs.openPlayer',
  'prefs.models',
  'prefs.modelsIntent',
  'prefs.packLabel',
  'prefs.pack.separation',
  'prefs.pack.piano',
  'prefs.pack.restore',
  'prefs.pack.transcription',
  'prefs.packDownloadTitle',
  'prefs.cancelDownload',
  'prefs.refresh',
  'prefs.taskFilter',
  'prefs.model',
  'prefs.task',
  'prefs.status',
  'prefs.size',
  'prefs.action',
  'prefs.ready',
  'prefs.installDeps',
  'prefs.download',
  'prefs.remove',
  'prefs.tools',
  'prefs.verovio',
  'prefs.verovioReady',
  'prefs.verovioHint',
  'prefs.installVerovio',
  'prefs.musescore',
  'prefs.musescoreFound',
  'prefs.musescoreMissing',
  'prefs.musePath',
  'prefs.setPath',
  'prefs.browse',
  'prefs.clearOverride',
  'prefs.museDownload',
  'prefs.soundfont',
  'prefs.soundfontReady',
  'prefs.soundfontHint',
  'prefs.downloadSf',
  'prefs.compute',
  'prefs.cacheBudget',
  'prefs.cacheIntent',
  'prefs.effectiveBudget',
  'prefs.diskFree',
  'prefs.warmTtl',
  'prefs.warmIntent',
  'prefs.applyEngine',
  'prefs.flush',
  'prefs.flushClear',
  'prefs.residents',
  'prefs.noneResident',
  'prefs.privacy',
  'prefs.privacyText',
  'prefs.removeWeightsConfirm',
  ...Object.keys(EN).filter((key) => key.startsWith('prefs.status.')),
]

describe('PreferencesModule i18n', () => {
  it('catalogues every Preferences key in English', () => {
    expect(missingKeys(EN, PREFERENCES_KEYS)).toEqual([])
  })

  it('renders the module through the catalogue — sentinels, not English literals', () => {
    const saved: Catalogue = {}
    for (const key of Object.keys(EN)) {
      if (key.startsWith('prefs.')) {
        saved[key] = EN[key]
        EN[key] = `[${key}]`
      }
    }
    try {
      const html = render(<PreferencesModule />)
      // Resolution: catalogue values flow into the markup for every statically
      // rendered surface.
      expect(html).toContain('[prefs.title]')
      expect(html).toContain('[prefs.interface]')
      expect(html).toContain('[prefs.models]')
      expect(html).toContain('[prefs.modelsIntent]')
      expect(html).toContain('[prefs.openPlayer]')
      expect(html).toContain('[prefs.taskFilter]')
      expect(html).toContain('[prefs.refresh]')
      expect(html).toContain('[prefs.verovioHint]')
      expect(html).toContain('[prefs.soundfontHint]')
      expect(html).toContain('[prefs.installVerovio]')
      expect(html).toContain('[prefs.residents]')
      expect(html).toContain('[prefs.privacyText]')
      // No hard-coded English leaks around those surfaces.
      expect(html).not.toContain('Open the player after import')
      expect(html).not.toContain('Download weights for available backends')
      expect(html).not.toContain('Task filter')
      expect(html).not.toContain('Refresh')
      expect(html).not.toContain('Cancel download')
      expect(html).not.toContain('pip install verovio')
      expect(html).not.toContain('GM SF2 for MIDI Studio.')
      expect(html).not.toContain('No telemetry by default')
    } finally {
      Object.assign(EN, saved)
    }
  })

  it('falls back to English when a catalogue is missing a key, and to the key when missing everywhere', () => {
    const partial: Catalogue = { ...EN }
    delete partial['prefs.title']
    // Deliberately missing key → English catalogue value.
    expect(translate(partial, 'prefs.title')).toBe(EN['prefs.title'])
    // Missing everywhere → the key itself (visible signal, never a crash).
    expect(translate(partial, 'prefs.doesNotExist')).toBe('prefs.doesNotExist')
  })

  it('substitutes template variables in Preferences strings', () => {
    expect(translate(EN, 'prefs.packLabel', { label: 'Separation' })).toBe('Separation pack')
    expect(translate(EN, 'prefs.status.removed', { name: 'demucs', mb: 42 })).toBe(
      'Removed demucs (42 MB freed).',
    )
  })
})
