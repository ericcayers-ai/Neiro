import type { ReactNode } from 'react'

/** Shared module title + short lede + optional actions row. */
export function ModuleHeader({
  title,
  lede,
  actions,
}: {
  title: string
  lede?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="module-header">
      <div className="module-header-copy">
        <h2>{title}</h2>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="module-header-actions">{actions}</div> : null}
    </header>
  )
}
