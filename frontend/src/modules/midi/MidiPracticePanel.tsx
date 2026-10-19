import { useEffect, useMemo, useRef, useState } from 'react'
import { useChromeCollapsed } from '../../hooks/useChromeCollapsed'
import { useDawBridge } from '../../hooks/useDawBridge'
import { IconChevronDown, IconChevronRight } from '../../icons'
import { useSession } from '../../state/session'
import { PlayerSurface, type PlayerNote } from '../../player/PlayerSurface'

/**
 * Practice mode on the shared real-time player.
 *
 * Everything the old panel claimed now happens in the player: count-in, A–B loop,
 * 25–400% speed, wait gating, markers and clips. No whole-file `/api/edit` render
 * runs when the speed changes, and no "pitch-preserving" label is hard-coded.
 */
export function MidiPracticePanel({ focus }: { focus: boolean }) {
  const { file, transcribeResult, setModule } = useSession()
  const [collapsed, setCollapsed] = useChromeCollapsed('neiro.practice.midi.collapsed', false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [expectedPitch, setExpectedPitch] = useState<number | null>(null)
  const [resumeToken, setResumeToken] = useState(0)

  const notes = useMemo<PlayerNote[]>(() => {
    if (!transcribeResult) return []
    return Object.values(transcribeResult.tracks || {})
      .flat()
      .map((event) => ({ onset: event.onset, pitch: event.pitch }))
      .sort((a, b) => a.onset - b.onset)
  }, [transcribeResult])

  const bpm = transcribeResult?.tempo_bpm || file?.report?.estimated_bpm || 100

  useEffect(() => {
    if (!focus || !panelRef.current) return
    setCollapsed(false)
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    panelRef.current.focus()
  }, [focus, setCollapsed])

  const { status: dawStatus, dawConnected } = useDawBridge({
    onMidiNoteOn: (pitch, _velocity, instanceId) => {
      if (!waiting) {
        setFeedback(`DAW MIDI ${pitch} from ${instanceId} (playback is not waiting)`)
        return
      }
      if (expectedPitch == null || pitch === expectedPitch) {
        setFeedback(`DAW injector (${instanceId}) played the expected pitch — resuming`)
        setResumeToken((value) => value + 1)
      } else {
        setFeedback(`DAW heard ${pitch}, expected ${expectedPitch} — try again`)
      }
    },
  })

  if (!file && !dawConnected) {
    return (
      <div className="gate">
        <div className="gate-title">Practice</div>
        <p className="gate-body">
          Import (and optionally transcribe) a track — or open the Neiro VST injector from your DAW.
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
          aria-label="Show practice panel"
          title="Show practice"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="practice-panel" id="midi-practice" tabIndex={-1}>
      <div className="practice-panel-head">
        <h2>Practice</h2>
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => setCollapsed(true)}
          aria-expanded
          aria-label="Hide practice panel"
          title="Hide practice"
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
          <div className="gate-title">DAW bridge active</div>
          <p className="gate-body">
            {dawStatus.instance_count} injector{dawStatus.instance_count === 1 ? '' : 's'}; focused{' '}
            {dawStatus.focus_instance || 'none'}. Set wait mode to WebMIDI or keyboard; a matching
            DAW note resumes a wait gate.
          </p>
        </div>
      )}

      {!transcribeResult && (
        <div className="gate">
          <div className="gate-title">No transcription yet</div>
          <p className="gate-body">
            The player works without it. Transcribe to get wait-at-each-note practice.
          </p>
          <button type="button" onClick={() => setModule('midi')}>
            Open Transcribe mode
          </button>
        </div>
      )}

      {file && (
        <PlayerSurface
          src={file.audioUrl}
          fileId={file.fileId}
          title={file.name}
          duration={file.report?.duration_seconds}
          bpm={bpm}
          notes={notes}
          resumeToken={resumeToken}
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

      {feedback && (
        <p className="muted" role="status" aria-live="polite">
          {feedback}
        </p>
      )}
    </div>
  )
}
