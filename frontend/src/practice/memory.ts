/**
 * Memory engine — PianoVision adoption leg D.
 *
 * Pure TypeScript: no DOM, no window, no audio, no timers, no side effects.
 *
 * PianoVision fades notes that you have already mastered so the ones you have not are the ones you
 * look at. This module is the arithmetic of that fade, and nothing else: given the per-bar accuracy
 * history of the passes already played, it returns an opacity in [MIN_OPACITY, 1] for any bar.
 *
 * Falsifiable claim (the leg's own acceptance): opacity CHANGES between passes for the same bar. A
 * bar that was played badly stays fully opaque; a bar that keeps coming out right fades each pass
 * until it reaches the floor and stops there.
 *
 * Data shapes are the same ones leg C already produces, so this module consumes
 * `PracticeScore.sections[].accuracy` values and the `bar` each note belongs to rather than
 * inventing a second history format:
 * - `frontend/src/practice/engine.ts` — `score()` returns `PracticeScore` with `sections` carrying
 *   `{ id, start, end, accuracy, missed }`.
 * - The caller maps repeated passes into `PassHistory` (one `{ barAccuracy }` per pass).
 */

/** A bar never fades below this, so a mastered passage is still visible on screen. */
export const MIN_OPACITY = 0.18;

/** Accuracy at or above this counts as mastered for the purposes of the fade. */
export const MASTERED_ACCURACY = 0.9;

/** How much of the remaining opacity one mastered pass removes. */
export const FADE_PER_MASTERED_PASS = 0.45

/**
 * How close to the floor counts as settled.
 *
 * The fade is geometric, so it approaches MIN_OPACITY without ever reaching it; requiring exact
 * equality would make `settled` unreachable. One percent of the usable range is where the remaining
 * difference stops being visible, so that is the threshold and it is stated rather than implied.
 */
export const SETTLE_EPSILON = 0.01;

/** One pass over one bar: what proportion of that bar's notes were hit (0..1) and how many were missed. */
export interface BarPass {
  /** Bar index (0-based, same index the caller uses for its own bar map). */
  bar: number;
  /** Hit fraction for this bar in this pass, clamped to 0..1 by the caller or here. */
  accuracy: number;
  /** Missed note count for this bar in this pass; optional, and only used to explain the opacity. */
  missed?: number;
}

/** All passes recorded so far. `passes[0]` is the first pass played, not the newest. */
export interface PassHistory {
  passes: BarPass[][];
}

export interface BarMemory {
  bar: number;
  /** 0..1 — what the renderer should draw. */
  opacity: number;
  /** Passes of this bar that reached MASTERED_ACCURACY. */
  masteredPasses: number;
  /** Total passes recorded for this bar. */
  passes: number;
  /** Mean accuracy over those passes, or null when the bar has never been played. */
  meanAccuracy: number | null;
  /** True when the bar has faded to the floor. */
  settled: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Opacity for one bar after `masteredPasses` clean passes.
 *
 * Each mastered pass removes FADE_PER_MASTERED_PASS of the distance to the floor, so the fade is
 * geometric rather than linear: pass 1 is a visible change, and the curve settles instead of
 * reaching the floor and then having nothing left to give. A bar with no mastered pass is fully
 * opaque.
 */
export function opacityForMasteredPasses(masteredPasses: number): number {
  const clean = Math.max(0, Math.floor(masteredPasses));
  if (clean === 0) return 1;
  const remaining = Math.pow(1 - FADE_PER_MASTERED_PASS, clean);
  return MIN_OPACITY + (1 - MIN_OPACITY) * remaining;
}

/**
 * Per-bar memory, derived from the pass history.
 *
 * `bars` is the complete set of bars the caller wants answers for (usually the target's own bar
 * map), so a bar that has never been played still gets an entry: fully opaque, `passes: 0`.
 */
export function buildBarMemory(history: PassHistory, bars: number[]): BarMemory[] {
  const wanted = Array.from(new Set(bars.map((bar) => Math.trunc(bar)))).sort((a, b) => a - b);
  const byBar = new Map<number, { mastered: number; total: number; accuracySum: number }>();
  for (const bar of wanted) byBar.set(bar, { mastered: 0, total: 0, accuracySum: 0 });

  for (const pass of history.passes) {
    // A pass may report the same bar twice (e.g. a repeat inside the pass); take the best reading
    // rather than letting one bad repeat outvote a clean run.
    const bestForBar = new Map<number, number>();
    for (const entry of pass) {
      const bar = Math.trunc(entry.bar);
      const accuracy = clamp01(entry.accuracy);
      const best = bestForBar.get(bar);
      if (best === undefined || accuracy > best) bestForBar.set(bar, accuracy);
    }
    for (const [bar, accuracy] of bestForBar) {
      const record = byBar.get(bar);
      if (!record) continue;
      record.total += 1;
      record.accuracySum += accuracy;
      if (accuracy >= MASTERED_ACCURACY) record.mastered += 1;
    }
  }

  return wanted.map((bar) => {
    const record = byBar.get(bar)!;
    const meanAccuracy = record.total === 0 ? null : record.accuracySum / record.total;
    const opacity = opacityForMasteredPasses(record.mastered);
    return {
      bar,
      opacity,
      masteredPasses: record.mastered,
      passes: record.total,
      meanAccuracy,
      settled: opacity - MIN_OPACITY <= SETTLE_EPSILON,
    };
  });
}

/**
 * Opacity lookup for a note's bar, which is what a renderer actually calls.
 *
 * A missing bar (the caller's map does not cover it) is treated as unplayed: fully opaque, because
 * hiding a note the app knows nothing about would be the wrong kind of quiet.
 */
export function opacityForBar(memory: BarMemory[], bar: number): number {
  const entry = memory.find((candidate) => candidate.bar === Math.trunc(bar));
  return entry ? entry.opacity : 1;
}

/**
 * Fold a new pass into the history. The history keeps every pass so the fade is reproducible; the
 * caller decides when to trim it.
 */
export function recordPass(history: PassHistory, pass: BarPass[]): PassHistory {
  return { passes: [...history.passes, pass.map((entry) => ({ ...entry }))] };
}

/**
 * Beats in a bar.
 *
 * 4/4 is the app's existing convention: `stemIdentity.snapTime` treats a bar as four beats
 * (`frontend/src/stemIdentity.ts:185`), and no MIDI time-signature meta event is parsed anywhere in this
 * repo. Inventing a per-file meter here would create a second, contradictory notion of a bar.
 */
export const BEATS_PER_BAR = 4

/**
 * Which bar a moment falls in, under that 4/4 convention.
 *
 * A missing or non-positive BPM would divide by zero, so it yields bar 0 rather than NaN: a note that
 * cannot be placed is not evidence of anything.
 */
export function barIndexOf(seconds: number, bpm: number, beatsPerBar: number = BEATS_PER_BAR): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(beatsPerBar) || beatsPerBar <= 0) return 0
  const barSeconds = (60 / bpm) * beatsPerBar
  return Math.floor(seconds / barSeconds)
}

/**
 * Turn one run's judgements into the per-bar accuracy record the memory engine consumes.
 *
 * A bar's accuracy is `hit / judged` for that bar in this run, counting only notes the run actually
 * judged. Pending notes are excluded, exactly as leg C's score excludes them: a note the run never
 * reached is not evidence either way.
 */
export function barPassesFromJudged(
  judged: readonly { state: string; note: { startSec: number } }[],
  bpm: number,
  beatsPerBar: number = BEATS_PER_BAR,
): BarPass[] {
  const counts = new Map<number, { hit: number; judged: number; missed: number }>()
  for (const entry of judged) {
    if (entry.state === 'pending') continue
    const bar = barIndexOf(entry.note.startSec, bpm, beatsPerBar)
    const record = counts.get(bar) ?? { hit: 0, judged: 0, missed: 0 }
    record.judged += 1
    if (entry.state === 'hit') record.hit += 1
    else record.missed += 1
    counts.set(bar, record)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bar, record]) => ({
      bar,
      accuracy: record.judged === 0 ? 0 : record.hit / record.judged,
      missed: record.missed,
    }))
}
