/**
 * Desktop QA sweep: visit every module, capture a screenshot, check horizontal
 * overflow and run axe-core through the browser runtime.
 *
 * Run: node tests/desktop-qa.mjs
 * Screenshots: %TEMP%/neiro-qa/*.png
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const exe = join(repo, 'src-tauri', 'target', 'release', 'neiro.exe')
const axeSource = readFileSync(join(repo, 'frontend', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const outDir = join(tmpdir(), 'neiro-qa')
mkdirSync(outDir, { recursive: true })

const modules = [
  ['Import', 'import'],
  ['Analysis', 'analysis'],
  ['Studio', 'studio'],
  ['Separate', 'separate'],
  ['Restore', 'restore'],
  ['MIDI', 'midi'],
  ['Library', 'library'],
  ['Prefs', 'preferences'],
  ['About', 'about'],
]

const mode = process.env.QA_MODE === 'desktop' ? 'desktop' : 'engine'
const python = join(repo, '.venv', 'Scripts', 'python.exe')
const port = 9900 + Math.floor(Math.random() * 90)
const app = mode === 'desktop'
  ? spawn(join(repo, 'src-tauri', 'target', 'release', 'neiro.exe'), [], {
      cwd: repo,
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
      stdio: 'ignore',
    })
  : null
const tempHome = mkdtempSync(join(tmpdir(), 'neiro-qa-home-'))
const portFile = join(tempHome, 'port.txt')
const engine = mode === 'desktop'
  ? null
  : spawn(python, ['-m', 'neiro.cli', 'ui', '--port', '0', '--port-file', portFile, '--no-browser'], {
      cwd: repo,
      env: {
        ...process.env,
        LOCALAPPDATA: join(tempHome, 'Local'),
        NEIRO_HOME: join(tempHome, 'cache'),
      },
      stdio: 'ignore',
    })

async function engineReady() {
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(portFile)) {
      const text = readFileSync(portFile, 'utf8').trim()
      if (text) return text
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('engine port file did not appear')
}

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
  if (mode === 'desktop') {
    if (!(await cdpReady())) throw new Error('WebView2 debug port did not open')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const pages = context.pages()
    var page = pages.find((item) => item.url().includes('127.0.0.1')) ?? pages[0]
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    await page.setViewportSize({ width: 1280, height: 800 })
  } else {
    const bound = await engineReady()
    browser = await chromium.launch({ headless: true })
    const width = Number(process.env.QA_WIDTH || 1280)
    const height = Number(process.env.QA_HEIGHT || 800)
    const context = await browser.newContext({ viewport: { width, height } })
    const theme = process.env.QA_THEME
    if (theme) {
      await context.addInitScript((value) => localStorage.setItem('neiro.pref.theme', value), theme)
    }
    var page = await context.newPage()
    await page.goto(`http://127.0.0.1:${bound}/`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1200)
  }

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  const report = []
  for (const [label, slug] of modules) {
    await page.locator('.rail-item').filter({ hasText: label }).first().click()
    await page.waitForTimeout(600)
    const shot = join(outDir, `${slug}${process.env.QA_THEME ? `-${process.env.QA_THEME}` : ''}.png`)
    await page.screenshot({ path: shot, fullPage: true })

    const metrics = await page.evaluate(() => {
      const width = window.innerWidth
      const overflow = [...document.querySelectorAll('*')].filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.right > width + 2
      })
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: width,
        pageOverflow: document.documentElement.scrollWidth > width + 2,
        overflowCount: overflow.length,
        overflowSample: overflow.slice(0, 5).map((element) => ({
          tag: element.tagName,
          className: String(element.className).slice(0, 60),
          right: Math.round(element.getBoundingClientRect().right),
        })),
      }
    })

    let axe = []
    try {
      axe = await page.evaluate(async (source) => {
        // eslint-disable-next-line no-new-func
        new Function(source)()
        const result = await window.axe.run(document, { resultTypes: ['violations'] })
        return result.violations
          .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({
              target: node.target,
              html: node.html.slice(0, 220),
              summary: node.failureSummary?.slice(0, 240),
            })),
          }))
      }, axeSource)
    } catch (error) {
      axe = [{ id: 'axe-error', impact: 'error', nodes: 1, detail: String(error).slice(0, 160) }]
    }

    report.push({ module: slug, shot, metrics, axe })
    console.log(
      `${slug}: pageOverflow=${metrics.pageOverflow} elementsOutsideViewport=${metrics.overflowCount} axe=${JSON.stringify(axe)}`,
    )
  }

  const summary = { consoleErrors, report }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(summary, null, 2))
  console.log('console errors:', consoleErrors.length)
  console.log('report:', join(outDir, 'report.json'))
} finally {
  await browser?.close().catch(() => {})
  const pid = mode === 'desktop' ? app?.pid : engine?.pid
  if (pid) {
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve())
    })
  }
}
