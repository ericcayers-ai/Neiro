import type { ReactNode } from 'react'
import { useSession } from '../state/session'

/** Consistent empty state when a module needs a loaded file. */
export function EmptyGate({
  title,
  children,
  actionLabel = 'Go to Import',
  onAction,
}: {
  title: string
  children: ReactNode
  actionLabel?: string
  onAction?: () => void
}) {
  const { setModule } = useSession()
  return (
    <div className="module-panel bleed module-enter empty-gate-panel">
      <div className="module-header">
        <div className="module-header-copy">
          <h2>{title}</h2>
        </div>
      </div>
      <div className="gate-wrap">
        <div className="gate" role="status">
          <div className="gate-title">No file loaded</div>
          <p className="gate-body">{children}</p>
          <button
            type="button"
            className="primary"
            onClick={() => (onAction ? onAction() : setModule('import'))}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
