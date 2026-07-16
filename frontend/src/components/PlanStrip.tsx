import { useEffect, useState } from 'react'
import { fetchPlan, type PlanStripPayload } from '../api/client'

/** Read-only planned DAG strip for Advanced workspace. */
export function PlanStrip(props: {
  kind: 'separate' | 'transcribe' | 'enhance'
  fileId: string
  preset?: string
  quality?: string
  bleed?: string
  mode?: string
  chain?: string
}) {
  const [plan, setPlan] = useState<PlanStripPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          chain: props.chain,
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
    props.chain,
  ])

  if (error) {
    return (
      <div className="plan-strip muted" role="status">
        Plan preview unavailable: {error}
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="plan-strip muted" role="status">
        Planning…
      </div>
    )
  }

  return (
    <div className="plan-strip" aria-label="Planned processing graph">
      <div className="plan-strip-head">
        <strong>Planned graph</strong>
        <span className="mono muted">
          {plan.model_id || 'dsp'}
          {plan.quality ? ` · ${plan.quality}` : ''}
        </span>
      </div>
      <ol className="plan-nodes">
        {plan.nodes.map((n) => (
          <li key={n.id} title={n.config}>
            <span className="plan-node-id">{n.id}</span>
            <span className="muted">{n.type}</span>
          </li>
        ))}
      </ol>
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
