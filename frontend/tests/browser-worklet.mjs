/**
 * Headless-browser check for the Studio per-stem shifter worklet.
 *
 * Node tests cover the kernel; this renders through a real Chromium
 * OfflineAudioContext + AudioWorklet to catch registration/loading mistakes.
 * It is not part of the gate because it needs a downloaded Chromium.
 *
 * Run: node tests/browser-worklet.mjs
 */
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const source = readFileSync(
  fileURLToPath(new URL('../src/player/worklet/stem-shift-worklet.js', import.meta.url)),
  'utf8',
)
const playerSource = readFileSync(
  fileURLToPath(new URL('../src/player/worklet/player-worklet.js', import.meta.url)),
  'utf8',
)

const server = http.createServer((req, res) => {
  if (req.url === '/worklet.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(source)
  } else if (req.url === '/player-worklet.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(playerSource)
  } else {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>worklet</title>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/`)

const result = await page.evaluate(async () => {
  const sr = 48000
  const ctx = new OfflineAudioContext(1, sr, sr)
  await ctx.audioWorklet.addModule('/worklet.js')
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 440
  const shifter = new AudioWorkletNode(ctx, 'neiro-stem-shift', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { semitones: 12, cents: 0 },
  })
  osc.connect(shifter)
  shifter.connect(ctx.destination)
  osc.start(0)
  const buffer = await ctx.startRendering()
  const samples = buffer.getChannelData(0)

  function goertzel(freq) {
    const start = Math.floor(sr * 0.25) // skip startup transient
    const n = samples.length - start
    const k = (2 * Math.PI * freq) / sr
    const coeff = 2 * Math.cos(k)
    let s0 = 0
    let s1 = 0
    let s2 = 0
    for (let i = start; i < samples.length; i += 1) {
      s0 = samples[i] + coeff * s1 - s2
      s2 = s1
      s1 = s0
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / n
  }

  const a440 = goertzel(440)
  const a880 = goertzel(880)
  return { a440, a880, peak: a880 > a440 ? 880 : 440 }
})

const player = await page.evaluate(async () => {
  const sr = 48000
  const tone = new Float32Array(sr)
  for (let i = 0; i < sr; i += 1) tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr)

  async function render(params) {
    const ctx = new OfflineAudioContext(1, sr, sr)
    await ctx.audioWorklet.addModule('/player-worklet.js')
    const node = new AudioWorkletNode(ctx, 'neiro-player', {
      outputChannelCount: [1],
      processorOptions: { channels: [tone], sampleRate: sr, params, from: 0, play: true },
    })
    node.connect(ctx.destination)
    const buffer = await ctx.startRendering()
    const samples = buffer.getChannelData(0)
    const start = Math.floor(sr * 0.25)
    function goertzel(freq) {
      const k = (2 * Math.PI * freq) / sr
      const coeff = 2 * Math.cos(k)
      let s0 = 0
      let s1 = 0
      let s2 = 0
      for (let i = start; i < samples.length; i += 1) {
        s0 = samples[i] + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (samples.length - start)
    }
    return {
      a440: goertzel(440),
      a880: goertzel(880),
      aTarget: goertzel(440 * Math.pow(2, (params.transpose || 0) / 12)),
    }
  }

  const speed2 = await render({ speed: 2 })
  const up12 = await render({ speed: 1, transpose: 12 })
  const up7 = await render({ speed: 1, transpose: 7 })
  return { speed2, up12, up7 }
})

await browser.close()
server.close()

console.log(JSON.stringify({ shifter: result, player }, null, 2))
if (!(result.a880 > result.a440 * 2)) {
  console.error('FAIL: shifted component (880 Hz) does not dominate')
  process.exit(1)
}
console.log('PASS: worklet shifts 440 Hz to 880 Hz in Chromium')
if (!(player.speed2.a440 > player.speed2.a880 * 2)) {
  console.error('FAIL: player at speed 2 did not preserve 440 Hz')
  process.exit(1)
}
if (!(player.up7.aTarget > player.up7.a440 * 2)) {
  console.error('FAIL: player +7 st did not produce the expected fractional pitch')
  process.exit(1)
}
if (!(player.up12.a880 > player.up12.a440 * 2)) {
  console.error('FAIL: player +12 st did not produce 880 Hz')
  process.exit(1)
}
console.log('PASS: player preserves pitch at speed 2 and transposes +12/+7 st')
