/**
 * Desktop updater runtime check: launch the built Tauri app with WebView2 remote
 * debugging, click About → Check for updates, and record what the UI reports.
 *
 * This does not install an update (that would replace the running app); it proves
 * the updater plugin is reachable from the real shell and that errors surface.
 * The configured endpoint is GitHub Releases, so "no release" is a valid result.
 *
 * Run: node tests/desktop-updater-runtime.mjs
 */
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const exe = join(repo, 'src-tauri', 'target', 'release', 'neiro.exe')
const port = 9300 + Math.floor(Math.random() * 400)

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
  await page.reload({ waitUntil: 'domcontentloaded', ignoreCache: true })
  await page.waitForTimeout(1500)
  console.log('page:', page.url())
  console.log(
    'internals:',
    await page.evaluate(() => ({
      tauriInternals: '__TAURI_INTERNALS__' in window,
      keys: Object.keys(window).filter((key) => key.toLowerCase().includes('tauri')),
      type: typeof window.__TAURI_INTERNALS__,
      invoke: typeof window.__TAURI_INTERNALS__?.invoke,
      scripts: [...document.scripts].map((script) => script.src),
    })),
  )

  await page.getByRole('button', { name: 'About' }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await page.waitForTimeout(8000)

  const text = await page.locator('[role="status"]').allTextContents()
  const message = text.find((item) => /update|latest|failed/i.test(item)) || text.join(' | ')
  console.log('updater status:', message)
  if (!message) throw new Error('no updater status text appeared')
  if (/Could not reach GitHub/.test(message)) {
    throw new Error('browser fallback was used: the Tauri IPC path was not active')
  }
  if (!/desktop updater|Update available|latest desktop build|Updater check failed/.test(message)) {
    throw new Error(`unexpected updater status: ${message}`)
  }
  console.log('PASS: desktop updater was invoked through Tauri IPC')
} finally {
  await browser?.close().catch(() => {})
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(app.pid), '/T', '/F'], () => resolve())
  })
}
