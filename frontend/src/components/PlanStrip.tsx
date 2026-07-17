import { useEffect, useState } from 'react'
import { fetchPlan, type PlanStripPayload } from '../api/client'
import type { AnalysisCorrectionsPayload } from '../api/types'
import { useChromeCollapsed } from '../hooks/useChromeCollapsed'
import { IconChevronDown, IconChevronRight } from '../icons'
import { useSession } from '../state/session'

const PLAN_COLLAPSE_KEY = 'neiro.planStrip.collapsed'

/** Read-only planned DAG strip — visual connected graph, not a flat table. */
export function PlanStrip(props: {
  kind: 'separate' | 'transcribe' | 'enhance'
  fileId: string
  preset?: string
  quality?: string
  bleed?: string
  mode?: string
  model?: string
  members?: string[]
  chain?: string
  /** When omitted, uses applied session analysisCorrections. */
  corrections?: AnalysisCorrectionsPayload | null
  /** Plain-language “connections” blurb for Separate presets. */
  connections?: string
}) {
  const { analysisCorrections, jobs } = useSession()
  const corrections = props.corrections !== undefined ? props.corrections : analysisCorrections
  const [plan, setPlan] = useState<PlanStripPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useChromeCollapsed(PLAN_COLLAPSE_KEY, false)
  const corrKey = corrections ? JSON.stringify(corrections) : ''
  const membersKey = props.members?.join(',') || ''

  const runningNodeId =
    jobs.find((j) => j.kind === props.kind && j.status === 'running')?.runningNodeId || null

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const next = await fetchPlan({
          kind: props.kind,
          file_id: props.fileId,
          preset: props.preset,
          quality: props.quality,
          bleed_suppress: props.bleed,
          mode: props.mode,
          model: props.model,
          members: props.members,
          chain: props.chain,
          corrections,
        })
        if (!cancelled) {
          setPlan(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [
    props.kind,
    props.fileId,
    props.preset,
    props.quality,
    props.bleed,
    props.mode,
    props.model,
    membersKey,
    props.chain,
    corrKey,
  ])

  if (collapsed) {
    return (
      <div className="plan-strip chrome-collapse is-collapsed" role="status">
        <button
          type="button"
          className="chrome-collapse-toggle ghost icon-btn"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label="Show planned graph"
          title="Show planned graph"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    )
  }

  const head = (
    <div className="plan-strip-head">
      <strong>Planned graph</strong>
      <div className="plan-strip-head-actions">
        {plan && (
          <span className="mono muted">
            {plan.model_id || 'dsp'}
            {plan.quality ? ` · ${plan.quality}` : ''}
          </span>
        )}
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => setCollapsed(true)}
          aria-label="Hide planned graph"
          title="Hide planned graph"
        >
          <IconChevronDown size={16} />
        </button>
      </div>
    </div>
  )

  if (error) {
    return (
      <div className="plan-strip muted" role="status">
        {head}
        Plan preview unavailable: {error}
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="plan-strip muted" role="status">
        {head}
        Planning…
      </div>
    )
  }

  const nodeIds = plan.nodes.map((n) => n.id)
  const indexOf = (id: string) => Math.max(0, nodeIds.indexOf(id))
  const colW = 140
  const rowH = 56
  const pad = 12
  // Simple layered layout by topological order (edge from→to).
  const depth = new Map<string, number>()
  for (const n of plan.nodes) depth.set(n.id, 0)
  let changed = true
  let guard = 0
  while (changed && guard++ < plan.nodes.length + 2) {
    changed = false
    for (const e of plan.edges) {
      const d = (depth.get(e.from) || 0) + 1
      if ((depth.get(e.to) || 0) < d) {
        depth.set(e.to, d)
        changed = true
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values())
  const lanes = new Map<number, string[]>()
  for (const n of plan.nodes) {
    const d = depth.get(n.id) || 0
    const list = lanes.get(d) || []
    list.push(n.id)
    lanes.set(d, list)
  }
  const pos = new Map<string, { x: number; y: number }>()
  for (let d = 0; d <= maxDepth; d++) {
    const ids = lanes.get(d) || []
    ids.forEach((id, i) => {
      pos.set(id, { x: pad + d * colW, y: pad + i * rowH })
    })
  }
  const svgW = pad * 2 + (maxDepth + 1) * colW
  const svgH = pad * 2 + Math.max(1, ...[...lanes.values()].map((l) => l.length)) * rowH

  return (
    <div className="plan-strip" aria-label="Planned processing graph">
      {head}
      <p className="intent plan-blurb">
        Planner = the local recipe of steps for this job (nothing leaves the machine).
      </p>
      {props.connections && <p className="intent plan-connections">{props.connections}</p>}

      <div className="plan-dag-wrap">
        <svg
          className="plan-dag"
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          role="img"
          aria-label="Processing dependency graph"
        >
          {plan.edges.map((e, i) => {
            const a = pos.get(e.from)
            const b = pos.get(e.to)
            if (!a || !b) return null
            const x1 = a.x + 100
            const y1 = a.y + 18
            const x2 = b.x
            const y2 = b.y + 18
            const mid = (x1 + x2) / 2
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                className="plan-dag-edge"
                fill="none"
              />
            )
          })}
          {plan.nodes.map((n) => {
            const p = pos.get(n.id) || { x: pad + indexOf(n.id) * colW, y: pad }
            const running = runningNodeId === n.id
            return (
              <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
                <rect
                  width={108}
                  height={36}
                  rx={4}
                  className={`plan-dag-node${running ? ' is-running' : ''}`}
                >
                  <title>{`${n.id} · ${n.type}\n${n.config}`}</title>
                </rect>
                <text x={8} y={15} className="plan-dag-id">
                  {n.id.length > 14 ? `${n.id.slice(0, 13)}…` : n.id}
                </text>
                <text x={8} y={28} className="plan-dag-type">
                  {n.type.length > 16 ? `${n.type.slice(0, 15)}…` : n.type}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {plan.notes?.length > 0 && (
        <ul className="intent plan-notes">
          {plan.notes.slice(0, 6).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
