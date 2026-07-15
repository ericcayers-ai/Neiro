import type { ReactNode } from 'react'

/** Labeled control with a one-line intent helper (roadmap language rules). */
export function IntentField({
  label,
  intent,
  children,
  htmlFor,
}: {
  label: string
  intent: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      <span className="intent">{intent}</span>
    </div>
  )
}
