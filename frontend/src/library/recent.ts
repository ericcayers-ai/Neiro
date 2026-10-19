export interface RecentSong {
  id: string
  title: string
  last_played?: number | null
  updated: number
}

/** Most recently played item, falling back to the last-updated one. */
export function mostRecentSong<T extends Pick<RecentSong, 'last_played' | 'updated'>>(
  songs: T[],
): T | null {
  if (!songs.length) return null
  return [...songs].sort(
    (a, b) => (b.last_played ?? b.updated) - (a.last_played ?? a.updated),
  )[0]
}
