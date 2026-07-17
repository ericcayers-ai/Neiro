/** Timeline ↔ media mapping for Studio clips (offset / sourceStart / sourceEnd). */

export interface StudioClip {
  id: string
  sourceStart: number
  sourceEnd: number
  offset: number
}

export interface StudioTrackLike {
  duration: number
  clips: StudioClip[]
}

/** Clip length on the timeline (and in the source window). */
export function clipLength(clip: StudioClip, trackDuration: number): number {
  const end = clip.sourceEnd > 0 ? clip.sourceEnd : trackDuration
  return Math.max(0, end - clip.sourceStart)
}

/** Clip that covers timeline time `t`, if any. */
export function clipAtTimeline(track: StudioTrackLike, t: number): StudioClip | null {
  for (const c of track.clips) {
    const len = clipLength(c, track.duration)
    if (len <= 0) continue
    if (t >= c.offset && t < c.offset + len) return c
  }
  return null
}

/**
 * Default view window for long files — show a useful initial span instead of
 * fitting the entire duration (Wave 5 fitter zoom).
 */
export function fitDefaultViewEnd(duration: number): number {
  if (!(duration > 0)) return 0
  if (duration <= 90) return duration
  return Math.min(duration, Math.max(60, duration * 0.25))
}

/**
 * Map timeline seconds → media (HTMLAudioElement) seconds.
 * Returns null when the playhead is outside every clip (silence for that track).
 */
export function timelineToMedia(track: StudioTrackLike, timelineT: number): number | null {
  const c = clipAtTimeline(track, timelineT)
  if (!c) return null
  return c.sourceStart + (timelineT - c.offset)
}

/**
 * Map media seconds → timeline seconds for the clip window that contains mediaT.
 * Returns null if mediaT is outside all clip source ranges.
 */
export function mediaToTimeline(track: StudioTrackLike, mediaT: number): number | null {
  for (const c of track.clips) {
    const end = c.sourceEnd > 0 ? c.sourceEnd : track.duration
    if (mediaT >= c.sourceStart && mediaT < end) {
      return c.offset + (mediaT - c.sourceStart)
    }
  }
  return null
}

/** End of the last clip on the timeline for a track. */
export function trackTimelineEnd(track: StudioTrackLike): number {
  let max = 0
  for (const c of track.clips) {
    max = Math.max(max, c.offset + clipLength(c, track.duration))
  }
  return Math.max(max, track.duration)
}
