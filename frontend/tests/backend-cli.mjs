/**
 * Backend CLI sweep: analyze → transcribe → enhance → separate on a generated tune,
 * with isolated LOCALAPPDATA/NEIRO_HOME and hard assertions on outputs.
 *
 * Run: node tests/backend-cli.mjs
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const python = join(repo, '.venv', 'Scripts', 'python.exe')
const work = mkdtempSync(join(tmpdir(), 'neiro-backend-'))

function synth(seconds = 4, rate = 44100) {
  const samples = Math.floor(seconds * rate)
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 261.63, 196.0]
  const data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples * 2, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i += 1) {
    const time = i / rate
    const index = Math.floor(time / 0.5) % notes.length
    const phase = (time % 0.5) / 0.5
    const env = Math.min(1, phase * 12) * Math.exp(-phase * 2)
    let value =
      (0.45 * Math.sin(2 * Math.PI * notes[index] * time) +
        0.18 * Math.sin(4 * Math.PI * notes[index] * time)) *
      env
    const beat = time % 0.5
    if (beat < 0.08) value += 0.4 * Math.sin(2 * Math.PI * 55 * time) * Math.exp(-beat * 45)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value * 0.7)) * 32767), 44 + i * 2)
  }
  return data
}

const wav = join(work, 'cli-tune.wav')
writeFileSync(wav, synth())

const env = {
  ...process.env,
  LOCALAPPDATA: join(work, 'Local'),
  NEIRO_HOME: join(work, 'cache'),
}

function run(name, args, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    execFile(python, ['-m', 'neiro.cli', ...args], { cwd: repo, env, timeout }, (error, stdout, stderr) => {
      const ms = Date.now() - started
      if (error) {
        reject(new Error(`${name} failed (${ms} ms): ${error.message}\n${stderr.slice(-800)}`))
        return
      }
      resolve({ ms, stdout, stderr })
    })
  })
}

const results = []
function record(name, detail) {
  results.push({ name, ...detail })
  console.log(`ok ${name}${detail.ms ? ` (${detail.ms}ms)` : ''}`)
}

try {
  const analyze = await run('analyze', ['analyze', wav])
  const report = JSON.parse(analyze.stdout.slice(analyze.stdout.indexOf('{')))
  if (!(report.duration_seconds > 3)) throw new Error('analysis duration wrong')
  if (!(report.estimated_bpm > 60 && report.estimated_bpm < 200)) throw new Error('bpm out of range')
  if (!report.estimated_key) throw new Error('no key')
  record('analyze', { ms: analyze.ms, bpm: report.estimated_bpm, key: report.estimated_key })

  const midiOut = join(work, 'cli.mid')
  const transcribe = await run('transcribe', ['transcribe', wav, '--json', '--no-download', '--out', midiOut])
  const transcription = JSON.parse(transcribe.stdout.slice(transcribe.stdout.indexOf('{')))
  const notes = Object.values(transcription.tracks || {}).flat().length
  if (notes < 4) throw new Error(`expected notes, got ${notes}`)
  if (!existsSync(midiOut) || statSync(midiOut).size < 50) throw new Error('midi file missing')
  record('transcribe', { ms: transcribe.ms, notes })

  const enhanced = join(work, 'cli-restored.wav')
  const enhance = await run('enhance', ['enhance', wav, '--chain', 'dehum,normalize', '--no-download', '--out', enhanced])
  if (!existsSync(enhanced) || statSync(enhanced).size < 10_000) throw new Error('enhanced wav missing')
  const header = readFileSync(enhanced).subarray(0, 4).toString()
  if (header !== 'RIFF') throw new Error('enhanced output is not a wav')
  record('enhance', { ms: enhance.ms, bytes: statSync(enhanced).size })

  const sepOut = join(work, 'stems')
  const separate = await run('separate', ['separate', wav, '--preset', 'vocals', '--no-download', '--quiet', '--out', sepOut])
  for (const stem of ['vocals.wav', 'instrumental.wav', 'residual.wav']) {
    const path = join(sepOut, stem)
    if (!existsSync(path) || statSync(path).size < 10_000) throw new Error(`stem missing: ${stem}`)
  }
  record('separate', {
    ms: separate.ms,
    nullTest: (separate.stderr.match(/Null test:.*/) || [''])[0],
  })

  writeFileSync(join(work, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`PASS: backend CLI sweep (${results.length} commands) — ${work}`)
} catch (error) {
  console.error(String(error))
  process.exitCode = 1
}
