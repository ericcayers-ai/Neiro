/** Minimal English string catalogue. New player/library strings go through `t()`. */

type Vars = Record<string, string | number>

const EN: Record<string, string> = {
  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.stop': 'Stop',
  'player.seek': 'Seek',
  'player.transpose': 'Transpose',
  'player.pitchCents': 'Fine pitch (cents)',
  'player.speed': 'Speed',
  'player.formant': 'Formant',
  'player.varispeed': 'Varispeed (pitch follows speed)',
  'player.reducer': 'Vocal reducer',
  'player.eq': 'Equalizer',
  'player.eqPreset': 'EQ preset',
  'player.tuning': 'Tuning reference',
  'player.countIn': 'Count-in',
  'player.loop': 'A–B loop',
  'player.setA': 'Set A',
  'player.setB': 'Set B',
  'player.clearLoop': 'Clear loop',
  'player.markers': 'Markers',
  'player.addMarker': 'Add marker',
  'player.clips': 'Clips',
  'player.createClip': 'Create clip from A–B',
  'player.playClip': 'Play clip',
  'player.waitMode': 'Wait mode',
  'player.waitOff': 'Continuous play',
  'player.waitKey': 'Step with Space / Enter',
  'player.waitMidi': 'WebMIDI pitch match',
  'player.waiting': 'Waiting for you — press Space/Enter or play MIDI {pitch}',
  'player.method': 'Method',
  'player.latency': 'Latency',
  'player.loading': 'Loading audio…',
  'player.failed': 'Audio could not be loaded: {error}',
  'player.countInActive': 'Count-in…',
  'player.noNotes': 'No transcription notes; wait mode uses time markers.',
  'player.clipSequence': 'Clip sequence',
  'player.playSequence': 'Play sequence',
}

export function t(key: string, vars?: Vars): string {
  const template = EN[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

export function availableLocales(): string[] {
  return ['en']
}
