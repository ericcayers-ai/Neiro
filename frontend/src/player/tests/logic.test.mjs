/** Pure-logic tests: transport state machine, markers, clips, ramp, labels. */

import test from 'node:test'
import assert from 'node:assert/strict'

import { Transport, clampSeek, formatTime } from '../Transport.ts'
import {
  addMarker,
  buildRamp,
  clipAt,
  makeClip,
  nextMarker,
  previousMarker,
  removeMarker,
  sequenceAt,
  sequenceDuration,
  sortMarkers,
} from '../markers.ts'
import { describeMethod, normalizeParams, soundingA4, tuningToCents } from '../params.ts'
import { formatProvenance } from '../provenance.ts'
import { addScene, applyScene, makeScene, removeScene } from '../scenes.ts'
import { MIDI_ACTIONS, MidiMapper, parseMidiMessage } from '../midi.ts'
import { libraryWrites, playerStorageKey, readPlayerArtifacts } from '../librarySync.ts'

test('transport plays, pauses and ends', () => {
  const transport = new Transport({ duration: 10 })
  transport.play(0)
  assert.equal(transport.tick(2), 'none')
  assert.equal(transport.position, 2)
  transport.pause()
  assert.equal(transport.tick(5), 'none')
  assert.equal(transport.position, 2)
  transport.play()
  assert.equal(transport.tick(9), 'ended')
  assert.equal(transport.position, 10)
  assert.equal(transport.playing, false)
})

test('A-B loop wraps at B and keeps playing', () => {
  const transport = new Transport({ duration: 100, loop: { enabled: true, start: 10, end: 20 } })
  transport.play(15)
  assert.equal(transport.tick(6), 'loop')
  assert.equal(transport.position, 11)
  assert.equal(transport.playing, true)
})

test('wait mode stops and only resume continues', () => {
  const transport = new Transport({ duration: 100 })
  transport.setWaitPoints([1, 2.5])
  transport.play(0)
  assert.equal(transport.tick(0.9), 'none')
  assert.equal(transport.tick(0.2), 'wait')
  assert.equal(transport.waiting, true)
  assert.equal(transport.playing, false)
  assert.equal(transport.tick(1), 'none')
  assert.equal(transport.position, 1.1)
  assert.equal(transport.resume(), true)
  assert.equal(transport.tick(1.3), 'none')
  assert.equal(transport.tick(0.2), 'wait')
  assert.ok(Math.abs(transport.position - 2.6) < 1e-9)
})

test('seek resets the wait index', () => {
  const transport = new Transport({ duration: 100 })
  transport.setWaitPoints([1, 5, 9])
  transport.play(0)
  transport.tick(1.1)
  assert.equal(transport.waiting, true)
  transport.seek(6)
  assert.equal(transport.waiting, false)
  transport.play()
  assert.equal(transport.tick(2.9), 'none')
  assert.equal(transport.tick(0.2), 'wait')
})

test('count-in duration follows tempo', () => {
  assert.ok(Math.abs(Transport.countInSeconds(120, 4) - 2) < 1e-9)
  assert.ok(Math.abs(Transport.countInSeconds(60, 2) - 2) < 1e-9)
  assert.ok(Transport.countInSeconds(0, 4) > 0)
})

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(65.9), '1:05')
  assert.equal(formatTime(-1), '0:00')
})

test('markers sort, add, remove and navigate', () => {
  let markers = addMarker([], 12, 'chorus')
  markers = addMarker(markers, 4, 'intro')
  markers = addMarker(markers, 8)
  assert.deepEqual(
    markers.map((m) => m.time),
    [4, 8, 12],
  )
  assert.equal(nextMarker(markers, 4)?.time, 8)
  assert.equal(previousMarker(markers, 12)?.time, 8)
  assert.equal(markers.length, 3)
  markers = removeMarker(markers, markers[0].id)
  assert.equal(markers.length, 2)
  assert.equal(sortMarkers(markers)[0].time, 8)
})

test('clips: at time, sequence and duration with loop counts', () => {
  const a = makeClip(0, 4, { loopCount: 2 })
  const b = makeClip(4, 8, { loopCount: 1 })
  assert.equal(clipAt([a, b], 2)?.id, a.id)
  assert.equal(clipAt([a, b], 4)?.id, b.id)
  assert.equal(sequenceDuration([a, b]), 12)
  assert.equal(sequenceAt([a, b], 5).clip?.id, a.id)
  assert.equal(sequenceAt([a, b], 9).clip?.id, b.id)
  assert.equal(sequenceAt([a, b], 12).clip, null)
})

test('ramp generator covers chromatic, fifths and scale ranges', () => {
  const chromatic = buildRamp({
    mode: 'chromatic',
    scale: 'major',
    fromSemitone: 0,
    toSemitone: 4,
    start: 0,
    end: 2,
    repetitions: 1,
  })
  assert.deepEqual(
    chromatic.map((clip) => clip.transpose),
    [0, 1, 2, 3, 4],
  )
  const scale = buildRamp({
    mode: 'scale',
    scale: 'major',
    fromSemitone: 0,
    toSemitone: 7,
    start: 0,
    end: 2,
    repetitions: 2,
  })
  assert.equal(scale.length, 10)
  assert.equal(scale[0].transpose, 0)
  assert.equal(scale[1].transpose, 0)
})

test('params clamp and the method label is honest', () => {
  const params = normalizeParams({ transpose: 99, speed: 0.01, formant: 5 })
  assert.equal(params.transpose, 36)
  assert.equal(params.speed, 0.25)
  assert.equal(params.formant, 2)
  assert.equal(params.eq.length, 6)
  assert.match(describeMethod(params).label, /Preview/)
  assert.match(describeMethod(normalizeParams({}), 'fallback').detail, /not preserved/)
  assert.match(describeMethod(normalizeParams({}), 'rendered').label, /Rendered/)
  assert.ok(Math.abs(tuningToCents(415) + 100) < 5)
})

test('provenance formatting and fallback caveat', () => {
  assert.match(formatProvenance({ engine: 'neiro-engine', method: 'phase-vocoder' }), /neiro-engine/)
  assert.match(formatProvenance(['pv', 'resample']), /pv → resample/)
  assert.equal(formatProvenance(null), 'method not reported')
})

test('scenes snapshot, replace by name, apply and remove', () => {
  const state = {
    params: normalizeParams({ transpose: 3, speed: 0.8, lowLatency: true }),
    loop: { enabled: true, start: 4, end: 12 },
    markers: [{ id: 'm1', time: 4, label: 'A' }],
    clips: [makeClip(4, 8)],
  }
  const scene = makeScene('Practice', state, 'clip-sequence')
  assert.equal(scene.name, 'Practice')
  assert.equal(scene.kind, 'clip-sequence')
  let scenes = addScene([], scene)
  scenes = addScene(scenes, makeScene('Warmup', state))
  assert.equal(scenes.length, 2)
  const replacement = makeScene('Practice', { ...state, loop: { enabled: false, start: null, end: null } })
  scenes = addScene(scenes, replacement)
  assert.equal(scenes.length, 2, 'same name replaces')
  const applied = applyScene(scenes.find((item) => item.name === 'Practice'))
  assert.equal(applied.params.transpose, 3)
  assert.equal(applied.loop.enabled, false)
  assert.equal(applied.markers.length, 1)
  assert.notEqual(applied.markers, scene.markers, 'apply returns copies')
  scenes = removeScene(scenes, replacement.id)
  assert.equal(scenes.length, 1)
})

test('midi parsing, learn, matching and persistence format', () => {
  assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: 'note', channel: 0, number: 60, value: 100 })
  assert.deepEqual(parseMidiMessage([0xb2, 7, 64]), { type: 'cc', channel: 2, number: 7, value: 64 })
  assert.equal(parseMidiMessage([0x80, 60, 0]), null, 'note-off ignored')
  assert.equal(parseMidiMessage([0xf8]), null)

  const mapper = new MidiMapper()
  mapper.learn({ action: 'play-pause', type: 'cc', number: 7, channel: null })
  mapper.learn({ action: 'transpose-up', type: 'note', number: 61, channel: 1 })
  assert.equal(mapper.handle({ type: 'cc', channel: 5, number: 7, value: 127 }), 'play-pause')
  assert.equal(mapper.handle({ type: 'note', channel: 1, number: 61, value: 100 }), 'transpose-up')
  assert.equal(mapper.handle({ type: 'note', channel: 0, number: 61, value: 100 }), null)
  mapper.clear('play-pause')
  assert.equal(mapper.handle({ type: 'cc', channel: 5, number: 7, value: 127 }), null)

  const restored = new MidiMapper()
  restored.load(mapper.toJSON())
  assert.equal(restored.mappings.length, 1)
  restored.load('not json')
  assert.equal(restored.mappings.length, 1, 'corrupt storage ignored')
  assert.ok(MIDI_ACTIONS.length >= 10)
})

test('A4 readout follows transpose and cents, and low-latency labels honestly', () => {
  assert.ok(Math.abs(soundingA4(normalizeParams({})) - 440) < 1e-9)
  assert.ok(Math.abs(soundingA4(normalizeParams({ transpose: 12 })) - 880) < 1e-9)
  assert.ok(Math.abs(soundingA4(normalizeParams({ pitchCents: 100 })) - 466.16) < 0.1)
  assert.match(describeMethod(normalizeParams({ lowLatency: true })).detail, /formant off/)
})

test('promotes player markers and clips from stored JSON', () => {
  const raw = JSON.stringify({
    params: { transpose: 2 },
    markers: [
      { id: 'm2', time: 8.5, label: 'chorus' },
      { id: 'm1', time: 1.25, label: '' },
      { id: 'bad', time: 'nope' },
    ],
    clips: [
      { id: 'c1', name: 'verse', start: 4, end: 12, loopCount: 2 },
      { id: 'c2', name: '', start: 2, end: 2 },
    ],
  })
  const artifacts = readPlayerArtifacts(raw)
  assert.equal(artifacts.markers.length, 2)
  assert.equal(artifacts.clips.length, 1)
  const writes = libraryWrites(artifacts)
  assert.deepEqual(writes.markers.map((marker) => marker.time), [1.25, 8.5])
  assert.equal(writes.clips[0].name, 'verse')
  assert.equal(writes.clips[0].loop_count, 2)
  assert.equal(playerStorageKey('abc'), 'neiro.player.abc')
})

test('artifact promotion tolerates missing and corrupt storage', () => {
  assert.deepEqual(readPlayerArtifacts(null), { markers: [], clips: [] })
  assert.deepEqual(readPlayerArtifacts('{broken'), { markers: [], clips: [] })
  assert.deepEqual(readPlayerArtifacts('{}'), { markers: [], clips: [] })
  assert.deepEqual(readPlayerArtifacts(JSON.stringify({ markers: 'nope', clips: 4 })), {
    markers: [],
    clips: [],
  })
})

test('clampSeek keeps relative seeks inside the track', () => {
  assert.equal(clampSeek(10, 5, 30), 15)
  assert.equal(clampSeek(28, 5, 30), 30)
  assert.equal(clampSeek(2, -5, 30), 0)
  assert.equal(clampSeek(30, 5, 0), 35, 'unknown duration is unbounded above')
})
