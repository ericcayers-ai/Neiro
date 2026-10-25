import type { Hand, MatchStats, ScoreResult, ScoredSection, Section } from './engine'

/**
 * End-of-run scoring surface (PianoVision adoption leg C) — presentational.
 *
 * Renders a `ScoreResult` from `score()` (frontend/src/practice/engine.ts):
 * overall accuracy, a per-hand breakdown, and the engine's ranked
 * `practiceThese` list (worst section first), ending with one real control
 * that hands the chosen section back to the caller so it can seed the
 * existing A–B loop.
 *
 * Honesty rules this component owns (do not dress numbers up):
 * - Accuracy is always shown with its sample size: notes judged and notes
 *   missed. 40% on four notes must not read like 40% on four hundred.
 * - Pending (not-yet-due) notes are never counted in the denominator; the
 *   engine's `MatchStats.pending` is surfaced as "not yet judged" text.
 * - Every number has a text label — colour carries no meaning here.
 *
 * SSR-safe: no `window`, no `document`, no canvas anywhere; render works with
 * `renderToStaticMarkup`.
 */

/** Worst sections shown before the list says "+ the rest exist". Exported so
 * the tests share it, the way `PianoRoll.ROLL_HEIGHT_PX` does. */
export const PRACTISE_LIST_LIMIT = 5

const HEADING_ID = 'score-summary-heading'

const HAND_LABELS: Record<Hand, string> = {
  left: 'Left hand',
  right: 'Right hand',
  unknown: 'Notes',
}

function formatPercent(accuracy: number): string {
  if (!Number.isFinite(accuracy)) return '—'
  const percent = Math.round(accuracy * 100)
  return `${Math.min(100, Math.max(0, percent))}%`
}

/** The honest sample-size line: judged and missed notes always visible.
 * When pending notes exist, the line leads with the judged fraction of the
 * whole target ("5 of 400 notes judged — 395 not yet judged"), so a small
 * sample can never read as a complete one. */
function describeStats(stats: MatchStats): string {
  const denominator = stats.total + stats.pending
  const parts: string[] = [
    stats.pending > 0
      ? `${stats.total} of ${denominator} notes judged`
      : `${stats.total} note${stats.total === 1 ? '' : 's'} judged`,
    `${stats.missed} missed`,
  ]
  if (stats.early > 0) parts.push(`${stats.early} early`)
  if (stats.late > 0) parts.push(`${stats.late} late`)
  if (stats.extra > 0) parts.push(`${stats.extra} extra`)
  if (stats.pending > 0) parts.push(`${stats.pending} not yet judged`)
  return parts.join(' · ')
}

export interface ScoreSummaryProps {
  /** A `score()` result over one run. Pending notes are in the result (the
   * engine alone keeps them out of the denominators); the summary reports
   * them through `MatchStats.pending` and the "not yet judged" lines. */
  result: ScoreResult
  /** True while the transport is playing: the summary is provisional. */
  running: boolean
  /** Called with the engine's `Section` when a practise control is used. */
  onPractiseSection?: (section: Section) => void
}

export function ScoreSummary({ result, running, onPractiseSection }: ScoreSummaryProps) {
  const handEntries = (['left', 'right', 'unknown'] as const)
    .map((hand) => ({ hand, stats: result.byHand[hand] }))
    .filter((entry): entry is { hand: Hand; stats: MatchStats } => Boolean(entry.stats))

  const practice = result.practiceThese.slice(0, PRACTISE_LIST_LIMIT)

  return (
    <section className="score-summary" aria-labelledby={HEADING_ID}>
      <h3 id={HEADING_ID}>Run summary</h3>
      {running && <p>Run in progress — the summary finalises when playback stops.</p>}
      {result.overall.total === 0 ? (
        <>
          <p>
            No notes judged yet. Play a pass (through the DAW bridge or the wait gates) and stop
            to see a score.
          </p>
          {result.overall.pending > 0 && (
            <p>
              0 of {result.overall.total + result.overall.pending} notes judged —{' '}
              {result.overall.pending} not yet judged.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="score-summary-overall">
            Overall <strong>{formatPercent(result.overall.accuracy)}</strong> —{' '}
            {describeStats(result.overall)}
          </p>
          {handEntries.length > 0 && (
            <ul className="score-summary-hands">
              {handEntries.map((entry) => (
                <li key={entry.hand}>
                  {HAND_LABELS[entry.hand]}: <strong>{formatPercent(entry.stats.accuracy)}</strong>{' '}
                  ({describeStats(entry.stats)})
                </li>
              ))}
            </ul>
          )}
          <h4>Practise first — worst sections</h4>
          {practice.length === 0 ? (
            <p>All judged sections scored 100% — nothing is flagged.</p>
          ) : (
            <ol className="score-summary-practise">
              {practice.map((entry) => (
                <PracticeRow
                  key={entry.section.index}
                  entry={entry}
                  onPractiseSection={onPractiseSection}
                />
              ))}
            </ol>
          )}
          {result.practiceThese.length > PRACTISE_LIST_LIMIT && (
            <p>
              Showing the worst {PRACTISE_LIST_LIMIT} of {result.practiceThese.length} sections.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function PracticeRow({
  entry,
  onPractiseSection,
}: {
  entry: ScoredSection
  onPractiseSection?: (section: Section) => void
}) {
  return (
    <li>
      <span>
        {entry.section.label}: <strong>{formatPercent(entry.stats.accuracy)}</strong> (
        {describeStats(entry.stats)})
      </span>
      {onPractiseSection && (
        <button type="button" onClick={() => onPractiseSection(entry.section)}>
          Practise {entry.section.label}
        </button>
      )}
    </li>
  )
}
