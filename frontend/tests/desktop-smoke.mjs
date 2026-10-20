/**
 * Desktop shell smoke: launch the release exe with WebView2 remote debugging and
 * visit every rail module, asserting the UI renders and no page error fires.
 *
 * Run: node tests/desktop-smoke.mjs
 */
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const exe = join(repo, 'src-tauri', 'target', 'release', 'neiro.exe')
const port = 9700 + Math.floor(Math.random() * 200)

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

const modules = [
  ['Import', 'Import'],
  ['Analysis', 'Analysis'],
  ['Studio', 'Studio'],
  ['Separate', 'Separate'],
  ['Restore', 'Restore'],
  ['MIDI', 'MIDI Studio'],
  ['Library', 'Library'],
  ['Prefs', 'Preferences'],
  ['About', 'About / Privacy'],
]

let browser
try {
  if (!(await cdpReady())) throw new Error('WebView2 debug port did not open')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const pages = context.pages()
  const page = pages.find((item) => item.url().includes('127.0.0.1')) ?? pages[0]
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  const visited = []
  for (const [label, expected] of modules) {
    await page.locator('.rail').getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(400)
    const body = await page.locator('body').innerText()
    if (!body.includes(expected)) {
      throw new Error(`module ${label} did not render "${expected}"`)
    }
    visited.push(label)
  }

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ visited, pageErrors: errors.length }, null, 2))
  console.log('PASS: every desktop module rendered without page errors')
} finally {
  await browser?.close().catch(() => {})
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(app.pid), '/T', '/F'], () => resolve())
  })
}
