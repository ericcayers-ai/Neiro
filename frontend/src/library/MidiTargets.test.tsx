import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MidiEvent, MidiTarget } from '../api/types'
import { I18nProvider } from '../i18n'
import { describeTarget } from '../practice/library'
import { MidiTargetCard } from './MidiTargets'

/**
 * Leg F's card contract: a library item shows what the file actually contains, and a file
 * too small to practise says why instead of offering a dead "Practise" button.
 *
 * These render the pure card through `renderToStaticMarkup` (the repo's SSR convention) so
 * no DOM, no fetch and no player is involved: what is asserted is the description arithmetic
 * and the refusal, both of which come from `frontend/src/practice/library.ts`.
 */

function note(onset: number, pitch: number, offset = 0.4): MidiEvent {
  return { onset, offset: onset + offset, pitch, velocity: 80, confidence: 1 }
}

function target(tracks: Record<string, MidiEvent[]>, tempo_bpm = 100): MidiTarget {
  return { id: 'mid_test', title: 'Étude', tempo_bpm, tracks, created: 0, updated: 0 }
}

function render(targetValue: MidiTarget): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <ul>
        <MidiTargetCard target={targetValue} onPractise={() => undefined} />
      </ul>
    </I18nProvider>,
  )
}

describe('MIDI target card', () => {
  it('describes a practisable target from its own notes', () => {
    // 8 notes whose last note ends 3.9 s after the first: 8 / 3.9 = 2.05 notes/s, inside the
    // engine's "moderate" band (2-4 notes/s).
    const tracks = {
      piano: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((onset, index) =>
        note(onset, 60 + index),
      ),
    }
    const descriptor = describeTarget(tracks)
    expect(descriptor.noteCount).toBe(8)
    expect(descriptor.notesPerSecond).toBeCloseTo(2.05, 2)

    const html = render(target(tracks))
    expect(html).toContain('Étude')
    expect(html).toContain('100 BPM')
    expect(html).toContain('8 notes')
    expect(html).toContain('2.1 notes/s')
    expect(html).toContain('moderate')
    expect(html).toContain('piano')
    // Practisable: the button is offered, not disabled.
    expect(html).toContain('Practise')
    expect(html).not.toContain('Not practisable yet')
  })

  it('refuses a file too small to practise and says why', () => {
    const tracks = { piano: [note(0, 60), note(0.5, 62), note(1, 64)] }
    const html = render(target(tracks))
    expect(html).toContain('Not practisable yet')
    expect(html).toContain('only 3 notes — needs at least 8')
    // The button is present but disabled, so a too-small file cannot start a run.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Practise<\/button>/)
  })

  it('names percussion when the importer tagged it', () => {
    const tracks = {
      piano: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((onset, index) => note(onset, 60 + index)),
      'kit.drums': [note(0, 36), note(1, 38), note(2, 42)],
    }
    const html = render(target(tracks))
    expect(html).toContain('Includes percussion')
    // Every track that carries notes is reported, drums included.
    expect(html).toContain('kit.drums')
  })

  it('links the imported file itself', () => {
    const tracks = { piano: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((onset, i) => note(onset, 60 + i)) }
    const html = render(target(tracks))
    expect(html).toContain('href="/api/library/midi-file/mid_test"')
    expect(html).toContain('download=""')
  })
})
