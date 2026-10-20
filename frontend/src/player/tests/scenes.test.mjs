import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_SCENES,
  applySceneToTracks,
  createScene,
  readScenes,
  serializeScenes,
  upsertScene,
} from '../../studio/scenes.ts'

const tracks = [
  { id: 'a', gain: 0.8, pan: -0.2, mute: false, solo: true },
  { id: 'b', gain: 1.1, pan: 0.3, mute: true, solo: false },
]

test('studio scenes round-trip and clamp values', () => {
  const scene = createScene('Verse', 1000, tracks, {
    loop: { start: 4, end: 12 },
    viewStart: 2,
    viewDur: 30,
    transpose: 99,
    speed: 5,
  })
  assert.equal(scene.transpose, 12)
  assert.equal(scene.speed, 2)
  assert.deepEqual(readScenes(serializeScenes([scene])), [scene])
})

test('invalid or hostile scene data is dropped, never thrown', () => {
  assert.throws(
    () => createScene('   ', 1, [], { loop: null, viewStart: 0, viewDur: 1, transpose: 0, speed: 1 }),
    /1\.\.60/,
  )
  assert.deepEqual(readScenes('not json'), [])
  assert.deepEqual(readScenes('{"version":2}'), [])
  const hostile = JSON.parse(
    '[{"version":1,"name":"x","tracks":[{"id":"a","gain":"loud"}],"loop":{"start":9,"end":3}}]',
  )
  const [scene] = readScenes(JSON.stringify(hostile))
  assert.equal(scene.tracks[0].gain, 1)
  assert.equal(scene.loop, null)
})

test('upsert replaces by name and caps the list', () => {
  let list = []
  for (let i = 0; i < MAX_SCENES + 3; i += 1) {
    list = upsertScene(
      list,
      createScene(`s${i}`, i, tracks, { loop: null, viewStart: 0, viewDur: 10, transpose: 0, speed: 1 }),
    )
  }
  assert.equal(list.length, MAX_SCENES)
  assert.equal(list[0].name, 's3')
  const replacement = createScene('s5', 999, tracks, {
    loop: null,
    viewStart: 1,
    viewDur: 5,
    transpose: 2,
    speed: 1.5,
  })
  list = upsertScene(list, replacement)
  assert.equal(list.filter((scene) => scene.name === 's5').length, 1)
  assert.equal(list.find((scene) => scene.name === 's5').transpose, 2)
})

test('applying a scene only changes matching tracks', () => {
  const scene = createScene('Mix', 1, [tracks[0]], {
    loop: null,
    viewStart: 0,
    viewDur: 10,
    transpose: 0,
    speed: 1,
  })
  const applied = applySceneToTracks(scene, [
    { id: 'a', gain: 1, pan: 0, mute: false, solo: false, extra: 'keep' },
    { id: 'c', gain: 0.5, pan: 0.1, mute: false, solo: false },
  ])
  assert.equal(applied[0].gain, 0.8)
  assert.equal(applied[0].solo, true)
  assert.equal(applied[0].extra, 'keep')
  assert.deepEqual(applied[1], { id: 'c', gain: 0.5, pan: 0.1, mute: false, solo: false })
})
