/**
 * Extension end-to-end: load the MV3 companion in a real Chromium, point it at a
 * dynamic-port engine, pair, check health, and upload a queued WAV.
 *
 * Capture is not exercised: it needs the side panel attached to a tab (Playwright
 * opens the panel as a tab) and a user permission bubble. That remains owner-run.
 *
 * Run: node tests/extension-e2e.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const python = join(repo, '.venv', 'Scripts', 'python.exe')
const work = mkdtempSync(join(tmpdir(), 'neiro-ext-e2e-'))
const portFile = join(work, 'port.txt')

function wav(seconds = 0.5, rate = 16000, freq = 440) {
  const samples = Math.floor(seconds * rate)
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
    data.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2)
  }
  return data
}

const server = spawn(
  python,
  ['-m', 'neiro.cli', 'ui', '--no-browser', '--port', '0', '--port-file', portFile],
  { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
)
let serverLog = ''
server.stdout.on('data', (chunk) => (serverLog += chunk))
server.stderr.on('data', (chunk) => (serverLog += chunk))

async function waitForPort() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const port = Number(readFileSync(portFile, 'utf8').trim())
      if (port > 0) {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`)
        if (res.ok) return port
      }
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`engine did not start\n${serverLog.slice(-2000)}`)
}

let context
try {
  const port = await waitForPort()
  const base = `http://127.0.0.1:${port}`
  const pair = await fetch(`${base}/api/pair/code`).then((r) => r.json())

  const extension = join(repo, 'addon')
  context = await chromium.launchPersistentContext(join(work, 'profile'), {
    headless: false,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })

  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 })
  const extensionId = new URL(worker.url()).host
  console.log('extension id:', extensionId)

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)

  await panel.fill('#engine-url', base)
  await panel.click('#engine-save')
  await panel.waitForFunction(
    (url) => document.getElementById('engine-url-status')?.textContent?.includes(url),
    base,
    { timeout: 5_000 },
  )

  await panel.fill('#pair-code', pair.code)
  await panel.click('#pair')
  await panel.waitForFunction(
    () => document.getElementById('pair-status')?.textContent?.includes('Paired'),
    undefined,
    { timeout: 10_000 },
  )

  await panel.click('#engine-check')
  await panel.waitForFunction(
    () => {
      const text = document.getElementById('engine-status')?.textContent || ''
      return text.includes('1.2.1') || text.includes('ok')
    },
    undefined,
    { timeout: 10_000 },
  )

  const file = join(work, 'queued.wav')
  writeFileSync(file, wav())
  await panel.setInputFiles('#queued-file', file)
  try {
    await panel.waitForFunction(
      () => document.getElementById('queued-status')?.textContent?.startsWith('Uploaded'),
      undefined,
      { timeout: 30_000 },
    )
  } catch (error) {
    const status = await panel.textContent('#queued-status')
    console.error('queued status:', status)
    console.error('server log tail:', serverLog.slice(-1500))
    throw error
  }

  const queued = await panel.textContent('#queued-status')
  console.log(JSON.stringify({ extensionId, port, queued }, null, 2))
  console.log('PASS: companion paired, health-checked and uploaded to the dynamic-port engine')
} finally {
  await context?.close().catch(() => {})
  server.kill()
  rmSync(work, { recursive: true, force: true })
}
