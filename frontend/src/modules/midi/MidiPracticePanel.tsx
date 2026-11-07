import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_EARLY_WINDOW_MS,
  matchEvents,
  nextExpectedOnset,
  parseTarget,
  score,
  sectionsFromMarkers,
  type JudgedNote,
  type MatchResult,
  type ObservedNote,
  type ScoreResult,
  type Section,
} from '../../practice/engine'
import { PianoRoll } from '../../practice/PianoRoll'
import { PianoVisionVRView } from '../../practice/PianoVisionVRView'
import { midiNoteName } from '../../practice/vrCalibration'
import {
  barIndexOf,
  barPassesFromJudged,
  buildBarMemory,
  opacityForBar,
  recordPass,
  type PassHistory,
} from '../../practice/memory'
import { ScoreSummary } from '../../practice/ScoreSummary'
import { useChromeCollapsed } from '../../hooks/useChromeCollapsed'
import { useDawBridge } from '../../hooks/useDawBridge'
import { IconChevronDown, IconChevronRight } from '../../icons'
import { useSession } from '../../state/session'
import { PlayerSurface, type PlayerNote } from '../../player/PlayerSurface'
import { MidiTargetTransport } from './MidiTargetTransport'
import { useT } from '../../i18n'

/**
 * Practice mode on the shared real-time player.
 *
 * Everything the old panel claimed now happens in the player: count-in, A–B loop,
 * 25–400% speed, wait gating, markers and clips. No whole-file `/api/edit` render
 * runs when the speed changes, and no "pitch-preserving" label is hard-coded.
 *
 * The practice roll (when a transcription target exists) draws the parsed
 * target as falling notes coloured by hand, judged by Leg A's `matchEvents`
 * over the DAW-injector observed stream, with `nowSec` coming from the
 * player's own transport clock via `PlayerSurface.onPosition` — no second
 * clock is created anywhere in this module.
 */

/** Minimum transport-time step the roll is redrawn for. The worklet posts
 * status roughly every 21 ms while playing; ~12 redraws/s is enough for a
 * practice roll and keeps the panel from re-rendering 45 times a second. This
 * is only a filter on the transport's own position stream, never a timer. */
const ROLL_REDRAW_INTERVAL_SEC = 0.08

/** The engine's live pending/missed boundary: a target note flips from
 * `pending` to `missed` when its matchable window has opened, i.e. once the
 * transport is within the early window of its onset (`MatchOptions.atSec`). */
const ROLL_OPEN_WINDOW_SEC = DEFAULT_EARLY_WINDOW_MS / 1000

/** How much backward movement counts as a run boundary. A transport position
 * materially before the previous one is an A–B loop wrap, a backward seek or
 * a restart: the judged stream resets so pass 2+ is never scored against a
 * stale gate onset. Smaller deltas (worklet clock jitter around an anchor
 * point) are not boundaries. */
const RUN_BOUNDARY_EPSILON_SEC = 0.001

/** External shape handed to PlayerSurface's `practiceLoop` seam: the practice
 * summary's "practise this section" sets the existing A–B loop to a section's
 * bounds and restarts the transport (token prevents stale re-application). */
interface PracticeLoopRequest {
  start: number
  end: number
  token: number
}

export function MidiPracticePanel({ focus }: { focus: boolean }) {
  const t = useT()
  const { file, transcribeResult, setModule } = useSession()
  const [collapsed, setCollapsed] = useChromeCollapsed('neiro.practice.midi.collapsed', false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [expectedPitch, setExpectedPitch] = useState<number | null>(null)
  const [resumeToken, setResumeToken] = useState(0)
  const [rollNow, setRollNow] = useState(0)
  const [streamVersion, setStreamVersion] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [vrMode, setVrMode] = useState(false)
  const [handFilter, setHandFilter] = useState<'all' | 'left' | 'right'>('all')

  /**
   * Memory fade (leg D): one pass per play -> stop, so mastered bars fade as the learner repeats them.
   *
   * The run boundary is the transport's own playing state, not `hasRun` — that flag only says the piece
   * has ever been played. A pass with nothing judged is dropped rather than counted, because a run that
   * never reached a bar is not evidence about it.
   */
  const [memoryHistory, setMemoryHistory] = useState<PassHistory>({ passes: [] })
  const rollNotesRef = useRef<JudgedNote[]>([])
  const wasPlayingRef = useRef(false)
  const [practiceLoopRequest, setPracticeLoopRequest] = useState<PracticeLoopRequest | null>(null)
  const lastRollEmitRef = useRef(-1)
  /** The panel's most recent transport position (one clock via onPosition);
   * free-play DAW notes are timestamped at this. */
  const practiceNowRef = useRef(0)

  /** Forwarder of PlayerSurface's transport position (one clock). Refs update
   * on every report; the roll state is throttled to ~12 redraws/s. A materially
   * backward position is a run boundary: the judged stream and gate onset
   * reset, and the version bump re-derives the match for the fresh pass. */
  const onRollPosition = useCallback((position: number) => {
    const previous = practiceNowRef.current
    practiceNowRef.current = position
    if (position < previous - RUN_BOUNDARY_EPSILON_SEC) {
      // Loop wrap / backward seek / restart: a new run. Without this, every
      // pass ≥ 2 of the A–B loop judged DAW notes against a stale onset.
      practiceStreamRef.current = []
      gateOnsetRef.current = 0
      setStreamVersion((version) => version + 1)
    }
    const last = lastRollEmitRef.current
    if (position < last || position - last >= ROLL_REDRAW_INTERVAL_SEC) {
      lastRollEmitRef.current = position
      setRollNow(position)
    }
  }, [])

  const notes = useMemo<PlayerNote[]>(() => {
    if (!transcribeResult) return []
    return Object.values(transcribeResult.tracks || {})
      .flat()
      .map((event) => ({ onset: event.onset, pitch: event.pitch }))
      .sort((a, b) => a.onset - b.onset)
  }, [transcribeResult])

  // Practice engine (leg A): the same transcribeResult.tracks the player uses,
  // matched against notes played through the DAW injector at wait gates.
  const practiceNotes = useMemo(() => parseTarget(transcribeResult?.tracks ?? {}), [transcribeResult])
  const practiceStreamRef = useRef<ObservedNote[]>([])
  const gateOnsetRef = useRef(0)

  const bpm = transcribeResult?.tempo_bpm || file?.report?.estimated_bpm || 100

  // Judgements for the roll and the summary. The stream (ref) only mutates at
  // DAW note-ons, so the matcher runs per `streamVersion`, not per frame; the
  // per-render map below applies the engine's live pending/missed boundary at
  // the transport position (`matchEvents` with `atSec: -Infinity` leaves every
  // unmatched note pending, matched hit/early/late carry their deltas). The
  // stream holds every played note-on: at wait gates (timestamped at the gate
  // onset) and during free playback (timestamped at the transport position).
  const rollMatch = useMemo<MatchResult>(
    () =>
      matchEvents(practiceNotes, practiceStreamRef.current, {
        atSec: Number.NEGATIVE_INFINITY,
      }),
    // streamVersion tracks practiceStreamRef.current mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [practiceNotes, streamVersion],
  )
  const rollBase = rollMatch.notes
  const rollNotes = useMemo<JudgedNote[]>(() => rollBase.map((judged) => (judged.state === 'pending' && judged.note.startSec - ROLL_OPEN_WINDOW_SEC <= rollNow ? { ...judged, state: 'missed' as const } : judged)), [rollBase, rollNow])
  rollNotesRef.current = rollNotes

  // Leg D: a pass ends when the transport stops after having played. Recording the pass here (rather than
  // on every judgement change) is what keeps one bar's history at one entry per run.
  useEffect(() => {
    if (wasPlayingRef.current && !playing) {
      const pass = barPassesFromJudged(rollNotesRef.current, bpm)
      if (pass.length > 0) setMemoryHistory((history) => recordPass(history, pass))
    }
    wasPlayingRef.current = playing
  }, [playing, bpm])

  // A new target is a new piece: its bar history must not carry over from the previous one.
  useEffect(() => {
    setMemoryHistory({ passes: [] })
  }, [file?.fileId, transcribeResult])

  const barMemory = useMemo(() => {
    const bars = new Set<number>()
    for (const note of practiceNotes) bars.add(barIndexOf(note.startSec, bpm))
    return buildBarMemory(memoryHistory, Array.from(bars))
  }, [memoryHistory, practiceNotes, bpm])

  // Sections for the summary: bar sections derived by the engine's
  // sectionsFromMarkers (no markers exist in the panel — the player owns
  // them), so `practiceThese` ranks real bars rather than one "All" bucket.
  const scoreSections = useMemo(
    () => sectionsFromMarkers(practiceNotes, [], { bpm }),
    [practiceNotes, bpm],
  )

  // The run summary: the same judgements the roll shows, scored by the
  // engine. Pending notes reach score() unfiltered — the engine excludes
  // them from the denominator itself (tally never counts pending in
  // `stats.total`) and reports the count in `stats.pending`, which the
  // summary labels "not yet judged". That keeps the denominator honest for
  // any caller, not just this filter line.
  const summary = useMemo<ScoreResult>(
    () =>
      score(
        {
          notes: rollNotes,
          extras: rollMatch.extras,
        },
        { sections: scoreSections },
      ),
    [rollNotes, rollMatch, scoreSections],
  )

  /** Practise this section: seed the existing A–B loop with the section's
   * bounds and restart the transport. The judged stream clears first — a
   * fresh loop pass must not inherit the previous pass's judgements. */
  const practiseSection = useCallback((section: Section) => {
    practiceStreamRef.current = []
    gateOnsetRef.current = 0
    setStreamVersion((version) => version + 1)
    setPracticeLoopRequest((previous) => ({
      start: Math.max(0, section.startSec),
      end: Math.max(section.startSec + 0.01, section.endSec),
      token: (previous?.token ?? 0) + 1,
    }))
  }, [])
  useEffect(() => {
    practiceStreamRef.current = []
    gateOnsetRef.current = 0
    setStreamVersion((version) => version + 1)
  }, [file?.fileId, transcribeResult])

  /** One status line on the existing feedback, no new UI chrome. */
  function practiceStatus(defaultText: string): string {
    const judged = matchEvents(practiceNotes, practiceStreamRef.current, {
      atSec: gateOnsetRef.current,
    }).notes
    const due = judged.filter((j) => j.state !== 'pending').length
    const matched = judged.filter(
      (j) => j.state === 'hit' || j.state === 'early' || j.state === 'late',
    ).length
    return `${defaultText} — Practice: ${matched}/${due}`
  }

  useEffect(() => {
    if (!focus || !panelRef.current) return
    setCollapsed(false)
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panelRef.current.focus()
  }, [focus, setCollapsed])

  const { status: dawStatus, dawConnected } = useDawBridge({
    onMidiNoteOn: (pitch, velocity, instanceId) => {
      if (practiceNotes.length && pitch != null) {
        if (waiting) {
          // The transport is parked at this gate, so a played note is timestamped
          // at the gate onset: musical time == the note it is answering.
          const before = matchEvents(practiceNotes, practiceStreamRef.current)
          const gateOnset =
            nextExpectedOnset(before, expectedPitch, gateOnsetRef.current) ??
            nextExpectedOnset(before, null, gateOnsetRef.current) ??
            gateOnsetRef.current
          practiceStreamRef.current.push({ timeSec: gateOnset, midi: pitch, velocity })
          gateOnsetRef.current = Math.max(gateOnsetRef.current, gateOnset)
          setStreamVersion((version) => version + 1)
        } else {
          // Free play (not at a gate): record the note-on at the panel's most
          // recent transport position so the end-of-run score covers the whole
          // pass, not only the wait gates. This is the transport's own clock
          // via onPosition — no second clock is created.
          practiceStreamRef.current.push({
            timeSec: practiceNowRef.current,
            midi: pitch,
            velocity,
          })
          setStreamVersion((version) => version + 1)
        }
      }
      if (!waiting) {
        setFeedback(`DAW MIDI ${pitch} from ${instanceId} (playback is not waiting)`)
        return
      }
      if (expectedPitch == null || pitch === expectedPitch) {
        setFeedback(
          practiceStatus(`DAW injector (${instanceId}) played the expected pitch — resuming`),
        )
        setResumeToken((value) => value + 1)
      } else {
        setFeedback(practiceStatus(`DAW heard ${pitch}, expected ${expectedPitch} — try again`))
      }
    },
  })

  if (!file && !dawConnected && practiceNotes.length === 0) {
    return (
      <div className="gate">
        <div className="gate-title">{t('practice.title')}</div>
        <p className="gate-body">
          Import (and optionally transcribe) a track, import a .mid target in Library — or open the
          Neiro VST injector from your DAW.
        </p>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div ref={panelRef} className="practice-panel is-collapsed" id="midi-practice" tabIndex={-1}>
        <button
          type="button"
          className="chrome-collapse-toggle ghost icon-btn"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={t('practice.showAria')}
          title={t('practice.showTitle')}
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="practice-panel" id="midi-practice" tabIndex={-1}>
      <div className="practice-panel-head">
        <h2>{t('practice.title')}</h2>
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => setCollapsed(true)}
          aria-expanded
          aria-label={t('practice.hideAria')}
          title={t('practice.hideTitle')}
        >
          <IconChevronDown size={16} />
        </button>
      </div>
      <p className="lede">
        Real-time transpose, fine pitch, 25–400% speed, formant, EQ, vocal reducer, A–B loop,
        count-in, markers and practice clips. The method label shows what is actually running
        (clean-room phase-vocoder preview, never a commercial stretcher).
      </p>

      {dawConnected && dawStatus && (
        <div className="gate" role="status" aria-live="polite">
          <div className="gate-title">{t('practice.dawActive')}</div>
          <p className="gate-body">
            {dawStatus.instance_count} injector{dawStatus.instance_count === 1 ? '' : 's'}; focused{' '}
            {dawStatus.focus_instance || 'none'}. Set wait mode to WebMIDI or keyboard; a matching
            DAW note resumes a wait gate.
          </p>
        </div>
      )}

      {!transcribeResult && (
        <div className="gate">
          <div className="gate-title">{t('practice.noTranscription')}</div>
          <p className="gate-body">
            The player works without it. Transcribe to get wait-at-each-note practice.
          </p>
          <button type="button" onClick={() => setModule('midi')}>
            Open Transcribe mode
          </button>
        </div>
      )}

      {practiceNotes.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
            <div className="row" style={{ gap: '0.4rem' }}>
              <button
                type="button"
                className={!vrMode ? 'active' : 'ghost'}
                onClick={() => setVrMode(false)}
              >
                2D Practice Roll
              </button>
              <button
                type="button"
                className={vrMode ? 'active' : 'ghost'}
                onClick={() => setVrMode(true)}
              >
                PianoVision 3D / VR Stage
              </button>
            </div>
          </div>

          {vrMode ? (
            <PianoVisionVRView
              notes={rollNotes}
              nowSec={rollNow}
              bpm={bpm}
              handFilter={handFilter}
              onHandFilterChange={setHandFilter}
              noteAlpha={(judged) => opacityForBar(barMemory, barIndexOf(judged.note.startSec, bpm))}
              onSimulatedNoteOn={(obs) => {
                practiceStreamRef.current.push(obs)
                setStreamVersion((v) => v + 1)
                if (waiting && (expectedPitch == null || obs.midi === expectedPitch)) {
                  setFeedback(
                    practiceStatus(
                      `VR Stage key ${midiNoteName(obs.midi)} (${obs.midi}) played — resuming`,
                    ),
                  )
                  setResumeToken((v) => v + 1)
                }
              }}
            />
          ) : (
            <PianoRoll
              notes={rollNotes}
              nowSec={rollNow}
              ariaLabel={t('practice.rollAria')}
              noteAlpha={(judged) => opacityForBar(barMemory, barIndexOf(judged.note.startSec, bpm))}
            />
          )}
        </>
      )}

      {hasRun && !waiting && (
        <ScoreSummary result={summary} running={playing} onPractiseSection={practiseSection} />
      )}

      {file && (
        <PlayerSurface
          src={file.audioUrl}
          fileId={file.fileId}
          title={file.name}
          duration={file.report?.duration_seconds}
          bpm={bpm}
          notes={notes}
          analysis={file.report}
          resumeToken={resumeToken}
          onPosition={onRollPosition}
          onPlayingChange={(isPlaying) => {
            setPlaying(isPlaying)
            if (isPlaying) setHasRun(true)
          }}
          practiceLoop={practiceLoopRequest}
          onWaitChange={(isWaiting, nextPitch) => {
            setWaiting(isWaiting)
            setExpectedPitch(nextPitch)
            if (isWaiting) {
              setFeedback(
                nextPitch == null
                  ? 'Waiting — press Space/Enter to continue.'
                  : `Waiting for MIDI ${nextPitch} (or Space/Enter).`,
              )
            }
          }}
        />
      )}

      {/* An imported .mid target has no recording, so it gets the same transport model on a wall
          clock instead of the worklet. Never both: this branch only runs when no audio is open. */}
      {!file && practiceNotes.length > 0 && (
        <>
          <MidiTargetTransport
            tracks={transcribeResult?.tracks ?? {}}
            bpm={bpm}
            onPosition={onRollPosition}
            practiceLoop={practiceLoopRequest}
            onPlayingChange={(isPlaying) => {
              setPlaying(isPlaying)
              if (isPlaying) setHasRun(true)
            }}
          />
          <p className="muted">{t('practice.targetNoAudio')}</p>
        </>
      )}

      {feedback && (
        <p className="muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  )
}
