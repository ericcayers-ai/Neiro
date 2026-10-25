// @vitest-environment jsdom
/* These tests drive React's `act`; declaring the act-environment flag keeps
 * React from warning "not configured to support act(...)" in the jsdom env. */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ScoreSummary,
  PRACTISE_LIST_LIMIT,
  type ScoreSummaryProps,
} from './ScoreSummary'
import type { MatchStats, ScoreResult, ScoredSection, Section } from './engine'

function stats(overrides: Partial<MatchStats> = {}): MatchStats {
  return {
    total: 10,
    hit: 4,
    early: 1,
    late: 1,
    missed: 4,
    pending: 0,
    extra: 0,
    accuracy: 0.4,
    ...overrides,
  }
}

function section(index: number, label: string): Section {
  return { index, label, startSec: index * 10, endSec: index * 10 + 10 }
}

function scored(index: number, label: string, statsOverrides: Partial<MatchStats> = {}): ScoredSection {
  return { section: section(index, label), stats: stats(statsOverrides) }
}

function result(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    overall: stats(),
    byHand: {
      left: stats({ total: 6, hit: 3, missed: 3, accuracy: 0.5 }),
      right: stats({ total: 4, hit: 1, missed: 1, accuracy: 0.25 }),
    },
    bySection: [
      scored(0, 'Bar 1'),
      scored(1, 'Bar 2', { accuracy: 0.8, hit: 8, missed: 2 }),
      scored(2, 'Bar 3', { accuracy: 0.2, hit: 2, missed: 8 }),
    ],
    practiceThese: [
      scored(2, 'Bar 3', { accuracy: 0.2, hit: 2, missed: 8 }),
      scored(0, 'Bar 1'),
      scored(1, 'Bar 2', { accuracy: 0.8, hit: 8, missed: 2 }),
    ],
    ...overrides,
  }
}

function props(overrides: Partial<ScoreSummaryProps> = {}): ScoreSummaryProps {
  return { result: result(), running: false, ...overrides }
}

describe('ScoreSummary SSR safety', () => {
  it('renders to static markup with the heading, overall percent and no NaN', () => {
    const html = renderToStaticMarkup(<ScoreSummary {...props()} />)
    expect(html).toContain('Run summary')
    expect(html).toContain('40%')
    expect(html).not.toContain('NaN')
  })

  it('a zero-note result renders an honest empty state, never NaN%', () => {
    const empty = result({
      overall: stats({ total: 0, hit: 0, accuracy: 0 }),
      byHand: {},
      practiceThese: [],
    })
    const html = renderToStaticMarkup(<ScoreSummary {...props({ result: empty })} />)
    expect(html).toContain('No notes judged yet')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('0 notes judged')
  })

  it('runs while playing mark the summary as provisional', () => {
    const html = renderToStaticMarkup(<ScoreSummary {...props({ running: true })} />)
    expect(html).toContain('Run in progress')
  })
})

describe('ScoreSummary honest numbers', () => {
  it('always shows the sample size: notes judged and notes missed with the percent', () => {
    const html = renderToStaticMarkup(<ScoreSummary {...props()} />)
    // 40% must read as 40% of 10 judged notes, not look like a big sample.
    expect(html).toContain('Overall')
    expect(html).toContain('10 notes judged')
    expect(html).toContain('4 missed')
    expect(html).toContain('40%')
  })

  it('pending notes are never in the denominator; they are named separately', () => {
    // Engine stats keep pending out of accuracy's denominator; the surfaced
    // line shows the judged fraction of the whole target.
    const html = renderToStaticMarkup(
      <ScoreSummary {...props({ result: result({ overall: stats({ pending: 7 }) }) })} />,
    )
    expect(html).toContain('7 not yet judged')
    expect(html).toContain('10 of 17 notes judged')
  })

  it('a barely-started run discloses how little was judged, so its 100% stays honest', () => {
    // 5 played (all hits), 395 still pending: "5 of 400 notes judged" is the
    // number that makes the 100% honest.
    const html = renderToStaticMarkup(
      <ScoreSummary
        {...props({
          result: result({ overall: stats({ total: 5, hit: 5, missed: 0, pending: 395, accuracy: 1 }) }),
        })}
      />,
    )
    expect(html).toContain('100%')
    expect(html).toContain('5 of 400 notes judged')
    expect(html).toContain('395 not yet judged')
  })

  it('an all-pending result renders the honest zero-judged state, never a bare percent', () => {
    const allPending = result({
      overall: stats({ total: 0, hit: 0, missed: 0, pending: 5, accuracy: 0 }),
      byHand: {},
      practiceThese: [],
    })
    const html = renderToStaticMarkup(<ScoreSummary {...props({ result: allPending })} />)
    expect(html).toContain('No notes judged yet')
    expect(html).toContain('0 of 5 notes judged')
    expect(html).toContain('5 not yet judged')
    expect(html).not.toContain('NaN')
  })

  it('the per-hand breakdown shows each hand with its own percent', () => {
    const html = renderToStaticMarkup(<ScoreSummary {...props()} />)
    expect(html).toContain('Left hand')
    expect(html).toContain('50%')
    expect(html).toContain('Right hand')
    expect(html).toContain('25%')
  })

  it('extras found during the pass are visible, not hidden', () => {
    const html = renderToStaticMarkup(
      <ScoreSummary {...props({ result: result({ overall: stats({ extra: 3 }) }) })} />,
    )
    expect(html).toContain('3 extra')
  })
})

describe('ScoreSummary ranked practise list', () => {
  it('renders sections worst first, exactly in the engine ranking', () => {
    const html = renderToStaticMarkup(<ScoreSummary {...props()} />)
    const worst = html.indexOf('Bar 3') // 20%
    const middle = html.indexOf('Bar 1') // 40%
    const best = html.indexOf('Bar 2') // 80%
    expect(worst).toBeGreaterThanOrEqual(0)
    expect(worst).toBeLessThan(middle)
    expect(middle).toBeLessThan(best)
  })

  it('truncates long rankings and states the honest scope of the list', () => {
    const bySection = Array.from({ length: 7 }, (_, i) =>
      scored(i, `Bar ${i + 1}`, { accuracy: 0.1 + i * 0.01 }),
    )
    const html = renderToStaticMarkup(
      <ScoreSummary {...props({ result: result({ bySection, practiceThese: bySection }) })} />,
    )
    // Only the PRACTISE_LIST_LIMIT worst survive; the rest are counted, not hidden.
    expect(html).toContain('Bar 5')
    expect(html).not.toContain('Bar 6')
    expect(html).not.toContain('Bar 7')
    expect(html).toContain(`Showing the worst ${PRACTISE_LIST_LIMIT} of 7 sections.`)
  })

  it('a fully-accurate run is reported as nothing being flagged', () => {
    const perfect = stats({ total: 10, hit: 10, missed: 0, accuracy: 1 })
    const html = renderToStaticMarkup(
      <ScoreSummary {...props({ result: result({ practiceThese: [], overall: perfect }) })} />,
    )
    expect(html).toContain('nothing is flagged')
  })
})

describe('ScoreSummary practise control (jsdom)', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    root?.unmount()
    host?.remove()
    root = null
    host = null
  })

  async function mount(props: ScoreSummaryProps): Promise<HTMLDivElement> {
    host = document.body.appendChild(document.createElement('div'))
    await act(async () => {
      root = createRoot(host!)
      root!.render(<ScoreSummary {...props} />)
    })
    return host!
  }

  it('the control is a real button with an accessible name, firing with the section', async () => {
    const onPractiseSection = vi.fn()
    const host = await mount(props({ onPractiseSection }))
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.length).toBe(3)
    // Accessible names come from the visible text: "Practise Bar 3" etc.
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Practise Bar 3',
      'Practise Bar 1',
      'Practise Bar 2',
    ])
    await act(async () => {
      buttons[0]!.click()
    })
    expect(onPractiseSection).toHaveBeenCalledTimes(1)
    // The callback receives the engine's Section object, not a label string.
    expect(onPractiseSection).toHaveBeenCalledWith(section(2, 'Bar 3'))
  })

  it('without onPractiseSection the numbers render but no control exists', async () => {
    const host = await mount(props())
    expect(host.querySelectorAll('button').length).toBe(0)
    expect(host.textContent).toContain('Bar 3')
  })
})
