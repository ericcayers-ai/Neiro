import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteMidiTarget,
  importMidiTarget,
  listMidiTargets,
  midiTargetFileUrl,
} from '../api/client'
import type { MidiTarget } from '../api/types'
import { usePlural, useT } from '../i18n'
import { describeTarget, whyTooSmallToPractise } from '../practice/library'
import { useSession } from '../state/session'

/**
 * MIDI targets — PianoVision adoption leg F, the UI half.
 *
 * A user's `.mid` becomes a library item: the card describes it from its own notes
 * (`describeTarget`), refuses a file that is too small to practise with the engine's own
 * reason rather than showing an empty card, and "Practise" hands `{ tracks, tempo_bpm }` to
 * the existing practice panel. Still no second player: the roll follows the player's worklet transport
 * when the recording is open, and — since leg G's transport gap was closed — the practice panel's own
 * metronome transport (`modules/midi/MidiTargetTransport.tsx`) when the target is all there is.
 */

export interface MidiTargetCardProps {
  target: MidiTarget
  onPractise?: (target: MidiTarget) => void
  onRemove?: (target: MidiTarget) => void
  removeDisabled?: boolean
}

/** Pure card: everything it shows is derived from `target.tracks`, never stored. */
export function MidiTargetCard({
  target,
  onPractise,
  onRemove,
  removeDisabled,
}: MidiTargetCardProps) {
  const t = useT()
  const descriptor = describeTarget(target.tracks)
  const refusal = whyTooSmallToPractise(descriptor)

  return (
    <li className="midi-target-card" data-testid={`midi-target-${target.id}`}>
      <div className="midi-target-head">
        <strong>{target.title}</strong>
        {target.tempo_bpm ? (
          <span className="muted"> · {Math.round(target.tempo_bpm)} BPM</span>
        ) : null}
      </div>
      {refusal ? (
        <p className="muted">{t('library.midiTooSmall', { reason: refusal })}</p>
      ) : (
        <p className="muted">
          {t('library.midiDescriptor', {
            notes: descriptor.noteCount,
            duration: descriptor.durationSec.toFixed(1),
            rate: descriptor.notesPerSecond.toFixed(1),
            difficulty: descriptor.difficultyLabel,
            channels: descriptor.channels.join(', ') || t('library.midiNoChannels'),
          })}
        </p>
      )}
      {descriptor.hasPercussion ? (
        <p className="muted">{t('library.midiPercussion')}</p>
      ) : null}
      <div className="row">
        <button
          type="button"
          onClick={() => onPractise?.(target)}
          disabled={refusal !== null}
          title={refusal ? t('library.midiTooSmall', { reason: refusal }) : undefined}
        >
          {t('library.midiPractise')}
        </button>
        <a className="btn-link" href={midiTargetFileUrl(target.id)} download>
          {t('library.midiDownload')}
        </a>
        <button type="button" onClick={() => onRemove?.(target)} disabled={removeDisabled}>
          {t('library.midiRemove')}
        </button>
      </div>
    </li>
  )
}

export function MidiTargets() {
  const t = useT()
  const plural = usePlural()
  const { file, setTranscribeResult, setModule, requestPracticeFocus } = useSession()
  const [targets, setTargets] = useState<MidiTarget[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await listMidiTargets()
      setTargets(list.targets)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onFiles = async (files: FileList | File[]) => {
    const picked = Array.from(files)[0]
    if (!picked) return
    setBusy(true)
    try {
      const result = await importMidiTarget(picked)
      setMessage(t('library.midiImported', { title: result.target.title }))
      await refresh()
    } catch (err) {
      setMessage(
        t('library.midiFailed', { error: err instanceof Error ? err.message : String(err) }),
      )
    } finally {
      setBusy(false)
    }
  }

  const practise = (target: MidiTarget) => {
    const tracks = target.tracks
    setTranscribeResult({
      model: 'midi-import',
      tempo_bpm: target.tempo_bpm || 120,
      event_count: Object.values(tracks).reduce((count, notes) => count + (notes?.length || 0), 0),
      midi_url: midiTargetFileUrl(target.id),
      tracks,
    })
    setModule('midi')
    requestPracticeFocus()
    // Two honest cases: with the recording open the roll follows the player's worklet clock;
    // without it the practice panel's metronome transport drives the same roll.
    setMessage(file ? t('library.midiLoaded') : t('library.midiOwnClock'))
  }

  const remove = async (target: MidiTarget) => {
    setBusy(true)
    try {
      await deleteMidiTarget(target.id)
      setMessage(t('library.midiRemoved', { title: target.title }))
      await refresh()
    } catch (err) {
      setMessage(
        t('library.midiFailed', { error: err instanceof Error ? err.message : String(err) }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={t('library.midiTargetsAria')}>
      <h3>{plural('library.midiTargets', targets.length)}</h3>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? t('library.midiWorking') : t('library.midiImport')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          aria-label={t('library.midiChooseAria')}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void onFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {message && (
        <p className="muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {targets.length === 0 ? (
        <p className="intent">{t('library.midiEmpty')}</p>
      ) : (
        <ul className="player-list">
          {targets.map((target) => (
            <MidiTargetCard
              key={target.id}
              target={target}
              onPractise={practise}
              onRemove={(item) => void remove(item)}
              removeDisabled={busy}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
