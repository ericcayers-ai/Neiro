/**
 * Desktop updater success path, dev-only.
 *
 * Requires a release exe built with an override config pointing the updater at
 * http://127.0.0.1:8766/latest.json and
 * `dangerousInsecureTransportProtocol: true` (Tauri refuses plain http otherwise).
 * Production config keeps HTTPS and never sets that flag.
 *
 * Serves a 1.2.2 manifest, launches the app with WebView2 remote debugging, and
 * asserts the UI offers 1.2.2. It does not click install/download.
 *
 * Run: node tests/updater-available.mjs
 */
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const exe = join(repo, 'src-tauri', 'target', 'release', 'neiro.exe')
const sigPath = join(
  repo,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'nsis',
  'Neiro_1.2.1_x64-setup.exe.sig',
)
const signature = readFileSync(sigPath, 'utf8').trim()
const manifest = {
  version: '1.2.2',
  notes: 'test update',
  pub_date: '2026-10-21T00:00:00Z',
  platforms: {
    'windows-x86_64': {
      signature,
      url: 'http://127.0.0.1:8766/Neiro_1.2.2_x64-setup.exe',
    },
  },
}

const server = http.createServer((req, res) => {
  if (req.url === '/latest.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(manifest))
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(8766, '127.0.0.1', resolve))

const port = 9400 + Math.floor(Math.random() * 300)
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
  if (!(await cdpReady())) {
    throw new Error('WebView2 debug port did not open (is the exe the dev test build?)')
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const pages = context.pages()
  const page = pages.find((item) => item.url().includes('127.0.0.1')) ?? pages[0]
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  await page.getByRole('button', { name: 'About' }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="status"]')].some((node) =>
        /Update available: 1\.2\.2/.test(node.textContent || ''),
      ),
    undefined,
    { timeout: 15_000 },
  )
  const status = await page.locator('[role="status"]').allTextContents()
  console.log('updater status:', status.join(' | '))
  console.log('PASS: desktop updater parsed latest.json and offered 1.2.2')
} finally {
  await browser?.close().catch(() => {})
  server.close()
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(app.pid), '/T', '/F'], () => resolve())
  })
}
