/**
 * Player DSP bench: algorithmic latency + real-time factor on this machine.
 * Writes one JSON line so the receipt can quote measured numbers, not estimates.
 */

import { PlayerDsp, PhaseVocoder } from '../worklet/player-worklet.js'

const SR = 44100
const SECONDS = 20

function programme(seconds, sr) {
  const n = Math.round(seconds * sr)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = i / sr
    // A few harmonics + slow amplitude movement: closer to music than a pure tone.
    const base = 0.18 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 330 * t)
    const shimmer = 0.05 * Math.sin(2 * Math.PI * 1760 * t)
    const envelope = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t)
    left[i] = (base + shimmer) * envelope
    right[i] = (base * 0.9 + shimmer * 0.8) * envelope
  }
  return [left, right]
}

function bench(label, params) {
  const channels = programme(SECONDS, SR)
  const dsp = new PlayerDsp(channels, SR)
  dsp.setParams(params)
  dsp.seek(0)
  const total = SECONDS * SR
  let rendered = 0
  const started = performance.now()
  while (rendered < total) {
    const block = dsp.render(128)
    rendered += block.left.length
    if (block.endOfSource) break
  }
  const elapsed = (performance.now() - started) / 1000
  return {
    label,
    rtF: Number((rendered / SR / elapsed).toFixed(2)),
    algorithmicLatencyMs: Number(((new PhaseVocoder(channels, SR).frameSize / SR) * 1000).toFixed(1)),
    msPerSecond: Number((elapsed * 1000).toFixed(0)),
  }
}

const results = [
  bench('speed 0.75 + transpose +4', { speed: 0.75, transpose: 4 }),
  bench('speed 1 + transpose 0', {}),
  bench('formant 0.8 + eq', { formant: 0.8, eq: [4, 2, 0, -2, 3, 1] }),
]
for (const result of results) console.log(JSON.stringify(result))
const worst = Math.min(...results.map((r) => r.rtF))
console.log(JSON.stringify({ worstRtF: worst, machine: process.platform, node: process.version }))
