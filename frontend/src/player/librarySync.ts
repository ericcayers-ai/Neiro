/**
 * Promote player-local artifacts into the library.
 *
 * The player keeps per-file markers and clips in `localStorage` so it works
 * without a library; the library is the durable store. This module turns the
 * stored snapshot into idempotent library writes without depending on the DOM.
 */

export interface PromotedMarker {
  time: number
  label: string
}

export interface PromotedClip {
  name: string
  start: number
  end: number
  loop_count: number
}

export interface PlayerArtifacts {
  markers: PromotedMarker[]
  clips: PromotedClip[]
}

interface StoredMarker {
  time?: unknown
  label?: unknown
}

interface StoredClip {
  name?: unknown
  start?: unknown
  end?: unknown
  loopCount?: unknown
}

/** Parse the player's stored snapshot; tolerate missing/corrupt fields. */
export function readPlayerArtifacts(raw: string | null): PlayerArtifacts {
  if (!raw) return { markers: [], clips: [] }
  let parsed: { markers?: unknown; clips?: unknown }
  try {
    parsed = JSON.parse(raw) as { markers?: unknown; clips?: unknown }
  } catch {
    return { markers: [], clips: [] }
  }
  const markers = Array.isArray(parsed.markers) ? (parsed.markers as StoredMarker[]) : []
  const clips = Array.isArray(parsed.clips) ? (parsed.clips as StoredClip[]) : []
  return {
    markers: markers
      .map((marker) => ({
        time: Number(marker?.time),
        label: String(marker?.label ?? '').trim(),
      }))
      .filter((marker) => Number.isFinite(marker.time) && marker.time >= 0),
    clips: clips
      .map((clip) => ({
        name: String(clip?.name ?? '').trim() || 'Clip',
        start: Number(clip?.start),
        end: Number(clip?.end),
        loop_count: Math.max(1, Math.round(Number(clip?.loopCount) || 1)),
      }))
      .filter(
        (clip) =>
          Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.end > clip.start,
      ),
  }
}

/** Library writes for a snapshot, in a stable order (markers, then clips). */
export function libraryWrites(artifacts: PlayerArtifacts): {
  markers: { time: number; label: string }[]
  clips: PromotedClip[]
} {
  return {
    markers: [...artifacts.markers].sort((a, b) => a.time - b.time),
    clips: [...artifacts.clips].sort((a, b) => a.start - b.start),
  }
}

export function playerStorageKey(fileId: string): string {
  return `neiro.player.${fileId}`
}
