/** Pure translation core, shared by the React provider and Node tests. */

export type Catalogue = Record<string, string>

export const EN: Catalogue = {
  'nav.import': 'Import',
  'nav.import.hint': 'Open a file or fetch a URL',
  'nav.analysis': 'Analysis',
  'nav.analysis.hint': 'Report for the current file',
  'nav.studio': 'Studio',
  'nav.studio.hint': 'Timeline, edits, and mix/export',
  'nav.separate': 'Separate',
  'nav.separate.hint': 'Stem separation jobs',
  'nav.restore': 'Restore',
  'nav.restore.hint': 'Enhancement and repair chains',
  'nav.midi': 'MIDI',
  'nav.midi.hint': 'Transcribe, roll, score, edit, practice',
  'nav.library': 'Library',
  'nav.library.hint': 'Songs, notes, markers, clips, playlists',
  'nav.preferences': 'Prefs',
  'nav.preferences.hint': 'Theme, density, models, compute',
  'nav.about': 'About',
  'nav.about.hint': 'Version, privacy, Studio shortcuts',
  'shell.rail': 'Modules',
  'shell.session': 'Session',
  'shell.saveSession': 'Save session…',
  'shell.openSession': 'Open session…',
  'shell.newSession': 'New session',
  'shell.palette': 'Command palette',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.open': 'Open',
  'common.export': 'Export',
}

export function translate(catalogue: Catalogue, key: string, vars?: Record<string, string | number>): string {
  const template = catalogue[key] ?? EN[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

export function missingKeys(catalogue: Catalogue, required: string[]): string[] {
  return required.filter((key) => !(key in catalogue))
}
