/** Named Studio layout scenes — pure data so they can be validated and tested. */

export type EqBands = [number, number, number]

export interface SceneTrack {
  id: string
  gain: number
  pan: number
  mute: boolean
  solo: boolean
  eq: EqBands
}

export interface SceneLoop {
  start: number
  end: number
}

export interface StudioScene {
  version: 1
  name: string
  createdAt: number
  tracks: SceneTrack[]
  loop: SceneLoop | null
  viewStart: number
  viewDur: number
  transpose: number
  speed: number
}

export const MAX_SCENES = 20

function clamp(value: unknown, lo: number, hi: number, fallback = lo): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(lo, Math.min(hi, number))
}

export interface SceneOptions {
  loop: SceneLoop | null
  viewStart: number
  viewDur: number
  transpose: number
  speed: number
}

export function createScene(
  name: string,
  createdAt: number,
  tracks: Array<Pick<SceneTrack, 'id' | 'gain' | 'pan' | 'mute' | 'solo'> & { eq?: EqBands }>,
  options: SceneOptions,
): StudioScene {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 60) throw new Error('scene name must be 1..60 characters')
  return {
    version: 1,
    name: trimmed,
    createdAt,
    tracks: tracks.map((track) => ({
      id: String(track.id),
      gain: clamp(track.gain, 0, 1.5, 1),
      pan: clamp(track.pan, -1, 1, 0),
      mute: Boolean(track.mute),
      solo: Boolean(track.solo),
      eq: [
        clamp(track.eq?.[0], -12, 12, 0),
        clamp(track.eq?.[1], -12, 12, 0),
        clamp(track.eq?.[2], -12, 12, 0),
      ] as EqBands,
    })),
    loop: options.loop
      ? {
          start: Math.max(0, Number(options.loop.start) || 0),
          end: Math.max(0, Number(options.loop.end) || 0),
        }
      : null,
    viewStart: Math.max(0, Number(options.viewStart) || 0),
    viewDur: Math.max(0.01, Number(options.viewDur) || 1),
    transpose: Math.round(clamp(options.transpose, -12, 12, 0)),
    speed: clamp(options.speed, 0.5, 2, 1),
  }
}

/** Parse untrusted storage; invalid entries are dropped, never thrown. */
export function normalizeScene(value: unknown): StudioScene | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || typeof raw.name !== 'string' || !raw.name.trim()) return null
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks
        .filter((track): track is Record<string, unknown> => Boolean(track) && typeof track === 'object')
        .map((track) => ({
          id: String(track.id ?? ''),
          gain: clamp(track.gain, 0, 1.5, 1),
          pan: clamp(track.pan, -1, 1, 0),
          mute: Boolean(track.mute),
          solo: Boolean(track.solo),
          eq: [
            clamp(Array.isArray(track.eq) ? track.eq[0] : 0, -12, 12, 0),
            clamp(Array.isArray(track.eq) ? track.eq[1] : 0, -12, 12, 0),
            clamp(Array.isArray(track.eq) ? track.eq[2] : 0, -12, 12, 0),
          ] as EqBands,
        }))
        .filter((track) => track.id)
    : []
  const loopRaw = raw.loop as Record<string, unknown> | null | undefined
  const loop =
    loopRaw && Number(loopRaw.end) > Number(loopRaw.start)
      ? { start: Math.max(0, Number(loopRaw.start) || 0), end: Math.max(0, Number(loopRaw.end) || 0) }
      : null
  return {
    version: 1,
    name: raw.name.trim().slice(0, 60),
    createdAt: Number(raw.createdAt) || 0,
    tracks,
    loop,
    viewStart: Math.max(0, Number(raw.viewStart) || 0),
    viewDur: Math.max(0.01, Number(raw.viewDur) || 1),
    transpose: Math.round(clamp(raw.transpose, -12, 12, 0)),
    speed: clamp(raw.speed, 0.5, 2, 1),
  }
}

export function upsertScene(scenes: StudioScene[], scene: StudioScene): StudioScene[] {
  const without = scenes.filter((item) => item.name !== scene.name)
  return [...without, scene]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_SCENES)
}

export function readScenes(raw: string | null): StudioScene[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeScene)
      .filter((scene): scene is StudioScene => scene !== null)
      .slice(-MAX_SCENES)
  } catch {
    return []
  }
}

export function serializeScenes(scenes: StudioScene[]): string {
  return JSON.stringify(scenes.slice(-MAX_SCENES))
}

/** Apply stored mix values by track id; order and unknown tracks are preserved. */
export function applySceneToTracks<
  T extends { id: string; gain: number; pan: number; mute: boolean; solo: boolean; eq?: EqBands },
>(
  scene: StudioScene,
  tracks: T[],
): T[] {
  const byId = new Map(scene.tracks.map((track) => [track.id, track]))
  return tracks.map((track) => {
    const saved = byId.get(track.id)
    return saved
      ? {
          ...track,
          gain: saved.gain,
          pan: saved.pan,
          mute: saved.mute,
          solo: saved.solo,
          eq: saved.eq,
        }
      : track
  })
}
