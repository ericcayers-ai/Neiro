/**
 * Desktop workflow: import a WAV through the real Import module, open Analysis,
 * then open the player — all in the release shell over the dynamic engine.
 *
 * Run: node tests/desktop-workflow.mjs
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const exe = join(repo, 'src-tauri', 'target', 'release', 'neiro.exe')
const port = 9800 + Math.floor(Math.random() * 150)
const work = mkdtempSync(join(tmpdir(), 'neiro-flow-'))

function wav(seconds = 1.5, rate = 16000, freq = 440) {
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

const file = join(work, 'flow-tone.wav')
writeFileSync(file, wav())

const app = spawn(exe, [], {
  cwd: repo,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
})

async function cdpReady() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return true
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

let browser
try {
  if (!(await cdpReady())) throw new Error('WebView2 debug port did not open')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const pages = context.pages()
  const page = pages.find((item) => item.url().includes('127.0.0.1')) ?? pages[0]
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1200)

  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.locator('.rail-item').filter({ hasText: 'Import' }).first().click()
  await page.locator('#module-content input[type=file]').first().setInputFiles(file)

  await page.getByText('flow-tone.wav').first().waitFor({ timeout: 30_000 })
  console.log('imported: flow-tone.wav')

  await page.locator('.rail-item').filter({ hasText: 'Analysis' }).first().click()
  await page.waitForFunction(
    () => /BPM|Integrated|LUFS|Key/i.test(document.body.innerText),
    undefined,
    { timeout: 20_000 },
  )
  console.log('analysis rendered')

  await page.locator('.rail-item').filter({ hasText: 'MIDI' }).first().click()
  await page.waitForTimeout(800)
  const body = await page.locator('body').innerText()
  if (!/Practice|MIDI Studio/i.test(body)) throw new Error('player/MIDI view did not render')

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ imported: 'flow-tone.wav', pageErrors: errors.length }))
  console.log('PASS: import → analysis → player in the packaged shell')
} finally {
  await browser?.close().catch(() => {})
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(app.pid), '/T', '/F'], () => resolve())
  })
  rmSync(work, { recursive: true, force: true })
}
