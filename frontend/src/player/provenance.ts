/**
 * Provenance types for the two quality paths. The player is a preview; the engine
 * is the rendered path. Every rendered result carries what actually ran.
 */

export type RenderEngine = 'neiro-engine' | 'clean-room-worklet' | 'browser-fallback'

export interface Provenance {
  engine: RenderEngine
  method: string
  model?: string | null
  params?: Record<string, unknown>
  sampleRate?: number
  duration?: number
  warnings?: string[]
}

export function formatProvenance(value: unknown): string {
  if (!value) return 'method not reported'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(String).join(' → ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const engine = typeof record.engine === 'string' ? record.engine : 'unknown engine'
    const method = typeof record.method === 'string' ? record.method : 'method not reported'
    return `${engine} · ${method}`
  }
  return String(value)
}

/** A fallback is honest only when it says it is one. */
export function requiresPitchCaveat(engine: RenderEngine | string): boolean {
  return engine === 'browser-fallback'
}
