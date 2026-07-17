import type { ReactNode } from 'react'
import { useChromeCollapsed } from '../hooks/useChromeCollapsed'
import { IconChevronDown, IconChevronRight, IconChevronUp } from '../icons'

type ChevronDir = 'up' | 'down' | 'right'

/** Collapsible chrome section — collapses to a chevron strip only. */
export function CollapsibleChrome({
  storageKey,
  label,
  children,
  className = '',
  defaultCollapsed = false,
  chevronWhenCollapsed = 'right',
  chevronWhenExpanded = 'down',
}: {
  storageKey: string
  label: string
  children: ReactNode
  className?: string
  defaultCollapsed?: boolean
  chevronWhenCollapsed?: ChevronDir
  chevronWhenExpanded?: ChevronDir
}) {
  const [collapsed, setCollapsed] = useChromeCollapsed(storageKey, defaultCollapsed)
  const Chevron = collapsed
    ? chevronWhenCollapsed === 'up'
      ? IconChevronUp
      : chevronWhenCollapsed === 'down'
        ? IconChevronDown
        : IconChevronRight
    : chevronWhenExpanded === 'up'
      ? IconChevronUp
      : chevronWhenExpanded === 'right'
        ? IconChevronRight
        : IconChevronDown

  return (
    <div className={`chrome-collapse${collapsed ? ' is-collapsed' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="chrome-collapse-toggle ghost icon-btn"
        onClick={() => setCollapsed()}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        title={collapsed ? `Show ${label}` : `Hide ${label}`}
      >
        <Chevron size={18} />
        {!collapsed && <span className="chrome-collapse-label">{label}</span>}
      </button>
      {!collapsed && <div className="chrome-collapse-body">{children}</div>}
    </div>
  )
}
