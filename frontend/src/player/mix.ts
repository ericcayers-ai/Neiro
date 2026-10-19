/** Target/backing focus for the Studio pre-mix bus. */

export function isTargetStem(name: string): boolean {
  return /vocal|singer|lead/i.test(name)
}

/**
 * Cross-fade between target (vocal) and backing stems.
 * `focus = 0.5` is unity for both; 1 boosts target and ducks backing, 0 the reverse.
 */
export function focusGain(isTarget: boolean, focus: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(focus) ? focus : 0.5))
  return isTarget ? 0.5 + f : 1.5 - f
}
