/** Player scenes: named snapshots of parameters, loop, markers and clips. */

import type { Clip, Marker } from './markers'
import type { PlayerParams } from './params'

export type SceneKind = 'standard' | 'timeline' | 'clip-sequence'

export interface SceneLoop {
  enabled: boolean
  start: number | null
  end: number | null
}

export interface SceneUi {
  compact: boolean
  eq: boolean
}

export interface SceneSnapshot {
  id: string
  name: string
  kind: SceneKind
  params: Partial<PlayerParams>
  loop: SceneLoop
  markers: Marker[]
  clips: Clip[]
  /** Panel arrangement captured with the scene; absent in older scenes. */
  ui?: SceneUi
  createdAt: number
}

export interface SceneState {
  params: Partial<PlayerParams>
  loop: SceneLoop
  markers: Marker[]
  clips: Clip[]
  ui?: SceneUi
}

function sceneId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function makeScene(
  name: string,
  state: SceneState,
  kind: SceneKind = 'standard',
): SceneSnapshot {
  return {
    id: sceneId(),
    name: name.trim() || 'Scene',
    kind,
    params: { ...state.params },
    loop: { ...state.loop },
    markers: state.markers.map((marker) => ({ ...marker })),
    clips: state.clips.map((clip) => ({ ...clip })),
    ui: state.ui ? { ...state.ui } : undefined,
    createdAt: Date.now(),
  }
}

export function addScene(scenes: SceneSnapshot[], scene: SceneSnapshot): SceneSnapshot[] {
  // Replacing a same-named scene is the expected "save over" behaviour.
  return [...scenes.filter((item) => item.name !== scene.name), scene]
}

export function removeScene(scenes: SceneSnapshot[], id: string): SceneSnapshot[] {
  return scenes.filter((scene) => scene.id !== id)
}

export function applyScene(scene: SceneSnapshot): SceneState {
  return {
    params: { ...scene.params },
    loop: { ...scene.loop },
    markers: scene.markers.map((marker) => ({ ...marker })),
    clips: scene.clips.map((clip) => ({ ...clip })),
    ui: scene.ui ? { ...scene.ui } : undefined,
  }
}

export function loadScenes(fileId: string): SceneSnapshot[] {
  try {
    const raw = localStorage.getItem(`neiro.player.${fileId}.scenes`)
    const parsed = raw ? (JSON.parse(raw) as SceneSnapshot[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistScenes(fileId: string, scenes: SceneSnapshot[]): void {
  try {
    localStorage.setItem(`neiro.player.${fileId}.scenes`, JSON.stringify(scenes))
  } catch {
    // storage full: keep the in-memory scenes
  }
}
