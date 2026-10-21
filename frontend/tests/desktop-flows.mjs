/**
 * End-to-end user flows against the real engine (isolated LOCALAPPDATA).
 * Generates musical test audio, then drives every module with assertions.
 *
 * Run: node tests/desktop-flows.mjs [step]
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const python = join(repo, '.venv', 'Scripts', 'python.exe')
const only = process.argv[2] ?? 'all'
const tempHome = mkdtempSync(join(tmpdir(), 'neiro-flow-'))
const outDir = join(tempHome, 'shots')
mkdirSync(outDir, { recursive: true })

function synth(seconds = 8, rate = 44100) {
  const samples = Math.floor(seconds * rate)
  const pcm = new Float32Array(samples)
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 261.63, 196.0]
  const noteLen = 0.5
  for (let i = 0; i < samples; i += 1) {
    const time = i / rate
    const index = Math.floor(time / noteLen) % notes.length
    const phase = (time % noteLen) / noteLen
    const env = Math.min(1, phase * 12) * Math.exp(-phase * 2.2)
    const f = notes[index]
    let value =
      0.45 * Math.sin(2 * Math.PI * f * time) +
      0.18 * Math.sin(2 * Math.PI * f * 2 * time) +
      0.08 * Math.sin(2 * Math.PI * f * 3 * time)
    value *= env
    // Kick on every half second for a clear beat.
    const beat = time % 0.5
    if (beat < 0.09) {
      value += 0.5 * Math.sin(2 * Math.PI * 55 * time) * Math.exp(-beat * 45)
    }
    pcm[i] = Math.max(-1, Math.min(1, value * 0.7))
  }
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
    data.writeInt16LE(Math.round(pcm[i] * 32767), 44 + i * 2)
  }
  return data
}

const wav = join(tempHome, 'flow-tune.wav')
writeFileSync(wav, synth())
const wav2 = join(tempHome, 'flow-second.wav')
writeFileSync(wav2, synth(1, 44100))

const portFile = join(tempHome, 'port.txt')
const engine = spawn(
  python,
  ['-m', 'neiro.cli', 'ui', '--port', '0', '--port-file', portFile, '--no-browser'],
  {
    cwd: repo,
    env: {
      ...process.env,
      LOCALAPPDATA: join(tempHome, 'Local'),
      NEIRO_HOME: join(tempHome, 'cache'),
      NEIRO_OPEN_PLAYER: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let engineLog = ''
engine.stdout.on('data', (chunk) => (engineLog += String(chunk)))
engine.stderr.on('data', (chunk) => (engineLog += String(chunk)))

async function boundPort() {
  for (let i = 0; i < 160; i += 1) {
    if (existsSync(portFile)) {
      const text = readFileSync(portFile, 'utf8').trim()
      if (text) return text
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`engine did not start:\n${engineLog.slice(-2000)}`)
}

let browser
let page
const log = []
const errors = []

async function step(name, run) {
  const started = Date.now()
  try {
    await run()
    await page?.screenshot({ path: join(outDir, `ok-${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {})
    log.push({ step: name, ms: Date.now() - started, ok: true })
    console.log(`ok ${name} (${Date.now() - started}ms)`)
  } catch (error) {
    log.push({ step: name, ms: Date.now() - started, ok: false, error: String(error) })
    await page?.screenshot({ path: join(outDir, `FAIL-${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {})
    throw error
  }
}

try {
  const port = await boundPort()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 } })
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('response', (response) => {
    if (response.url().includes('/api/')) {
      console.log('API', response.status(), response.request().method(), new URL(response.url()).pathname)
    }
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? ''
    // Media elements abort their range requests when a new src replaces them.
    if (failure.includes('ERR_ABORTED') && request.url().includes('/files/')) return
    errors.push(`requestfailed ${request.url()} ${failure}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Deliberate 4xx responses (SSRF rejection, oversize budget) log a resource error.
    if (message.text().startsWith('Failed to load resource')) return
    errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${port}/`)

  const rail = (label) => page.locator('.rail-item').filter({ hasText: label }).first()
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') await dialog.accept('QA scene')
    else await dialog.accept()
  })
  const waitJobs = async (timeout = 240_000) => {
    await page.waitForFunction(
      () => {
        const text = document.querySelector('.job-tray')?.innerText ?? ''
        return /0 active/i.test(text) && !/running ·/i.test(text)
      },
      undefined,
      { timeout },
    )
  }

  if (only !== 'none' && only !== 'queue') {
    await step('import audio file', async () => {
      await page.locator('#module-content input[type=file]').first().setInputFiles(wav)
      await page.waitForFunction(
        () => {
          const shell = document.querySelector('.shell')
          return Boolean(shell) && !shell.innerText.includes('No file — Import a track')
        },
        undefined,
        { timeout: 180_000 },
      )
      const header = await page.locator('.shell').innerText()
      if (!/flow-tune\.wav/.test(header)) throw new Error('session header missing file name')
      console.log('IMPORT MODULE:', (await page.locator('#module-content').innerText()).slice(0, 600))
      console.log('JOB TRAY:', (await page.locator('.job-tray').innerText().catch(() => 'none')).slice(0, 300))
    })
  }

  if (only === 'all' || only === 'analysis') {
    await step('analysis report', async () => {
      await rail('Analysis').click()
      await page.getByText(/Report for flow-tune\.wav/).waitFor({ timeout: 30_000 })
      const text = await page.locator('#module-content').innerText()
      for (const expected of ['BPM', 'C major', 'Chords', 'Beats']) {
        if (!text.includes(expected)) throw new Error(`analysis missing ${expected}`)
      }
      // Toggle each analysis lane and confirm the matching lane section disappears.
      const boxes = page.locator('#module-content input[type=checkbox]')
      const count = await boxes.count()
      for (let i = 0; i < Math.min(count, 3); i += 1) {
        await boxes.nth(i).uncheck()
        await boxes.nth(i).check()
      }
    })
  }

  if (only === 'all' || only === 'studio') {
    await step('studio transport, transpose, EQ, scene', async () => {
      await rail('Studio').click()
      await page.getByRole('button', { name: 'Play', exact: true }).first().click()
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Stop', exact: true }).first().click()

      const speed = page.locator('#module-content select').first()
      await speed.selectOption('1.5')
      const transpose = page.locator('#module-content input[type=number]').first()
      await transpose.fill('2')
      await transpose.blur()
      const lowEq = page.getByLabel('Flow tune.wav L EQ')
      await lowEq.fill('3')
      if ((await lowEq.inputValue()) !== '3') throw new Error('EQ did not update')
      await page.getByRole('button', { name: 'Chords', exact: true }).click()
      await page.locator('.studio-chords').waitFor({ timeout: 10_000 })
      const spectro = page.getByRole('button', { name: 'Spectrogram lane', exact: true })
      await spectro.click()
      await page.waitForTimeout(200)
      await spectro.click()

      await page.getByRole('button', { name: 'Save scene', exact: true }).click()
      await page.waitForTimeout(400)
      const sceneOptions = await page.locator('#module-content select').last().innerText()
      if (!sceneOptions.includes('QA scene')) throw new Error('scene was not saved')

      await speed.selectOption('2')
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.waitForTimeout(500)
      if ((await speed.inputValue()) !== '1.5') throw new Error('scene apply did not restore speed')
      await page.getByRole('button', { name: 'Del scene', exact: true }).click()
      await page.waitForTimeout(400)
      const afterDelete = await page.locator('#module-content select').last().innerText()
      if (afterDelete.includes('QA scene')) throw new Error('scene was not deleted')
    })

    await step('studio render stems (queued engine)', async () => {
      await page.getByRole('button', { name: 'Render stems', exact: true }).click()
      await page.getByRole('button', { name: 'Render stems', exact: true }).waitFor({
        state: 'visible',
        timeout: 180_000,
      })
      await page.waitForTimeout(500)
      await waitJobs()
      const text = await page.locator('#module-content').innerText()
      if (!/Stems rendered/i.test(text)) throw new Error('render did not finish')
      console.log('STUDIO AFTER RENDER:', text.slice(-400).replace(/\n+/g, ' | '))
    })

    await step('studio add/import/delete tracks', async () => {
      const countTracks = () => page.locator('.studio-track').count()
      const before = await countTracks()
      await page.getByRole('button', { name: '+ Track', exact: true }).click()
      await page.waitForFunction((n) => document.querySelectorAll('.studio-track').length === n + 1, before)
      await page.getByRole('button', { name: 'Del', exact: true }).first().click()
      await page.waitForFunction((n) => document.querySelectorAll('.studio-track').length === n, before)

      await page.locator('#module-content input[type=file]').first().setInputFiles(wav)
      await page.waitForFunction((n) => document.querySelectorAll('.studio-track').length === n + 1, before, {
        timeout: 60_000,
      })
      await page.locator('.studio-track-head').first().click()
      await page.getByRole('button', { name: 'Del', exact: true }).first().click()
      await page.waitForFunction((n) => document.querySelectorAll('.studio-track').length === n, before)
    })

    await step('studio export link', async () => {
      await page.getByRole('button', { name: 'Mix', exact: true }).first().click()
      const link = page.locator('#module-content a[href*="/api/export"]').first()
      await link.waitFor({ timeout: 15_000 })
      const href = await link.getAttribute('href')
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url)
        const blob = await response.blob()
        return { status: response.status, size: blob.size }
      }, href)
      if (result.status !== 200 || result.size < 1000) {
        throw new Error(`export failed: ${JSON.stringify(result)}`)
      }
      console.log('EXPORT:', JSON.stringify(result))
      await page.getByRole('button', { name: 'Mix', exact: true }).first().click()
    })

    await step('studio pitch correct', async () => {
      await page.locator('.studio-track-head').first().click()
      await page.waitForTimeout(300)
      const before = await page.locator('.studio-track').count()
      await page.getByRole('button', { name: 'Pitch correct', exact: true }).click()
      await page.waitForFunction(
        () => /Pitch correct →|Pitch correct (failed|cancelled)|unexpected payload/i.test(document.body.innerText),
        undefined,
        { timeout: 180_000 },
      )
      const text = await page.locator('#module-content').innerText()
      if (!/Pitch correct →/.test(text)) throw new Error(`pitch correct failed: ${text.slice(-300)}`)
      await page.waitForFunction((n) => document.querySelectorAll('.studio-track').length === n + 1, before)
      await waitJobs()
      console.log('PITCH RESULT:', text.slice(-160).replace(/\n+/g, ' | '))
    })

    await step('studio bounce, undo, redo, toggles', async () => {
      await page.getByRole('button', { name: 'Bounce', exact: true }).first().click()
      await page.waitForTimeout(600)
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.getByRole('button', { name: 'Redo', exact: true }).click()
      await page.getByRole('button', { name: 'Compact', exact: true }).click()
      await page.getByRole('button', { name: 'Real-time', exact: true }).click()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    })
  }

  if (only === 'all' || only === 'restore') {
    await step('restore auto chain', async () => {
      await rail('Restore').click()
      await page.getByRole('button', { name: 'Restore', exact: true }).last().click()
      await waitJobs()
      const text = await page.locator('#module-content').innerText()
      console.log('RESTORE RESULT:', text.slice(-500).replace(/\n+/g, ' | '))
      if (/failed/i.test(text) && !/suggest/i.test(text)) throw new Error('restore reported failure')
    })
  }

  if (only === 'restore-presets') {
    await step('restore presets', async () => {
      await rail('Restore').click()
      const values = await page.locator('#restore-chain option').evaluateAll((options) =>
        options.map((option) => option.value),
      )
      for (const value of values) {
        await page.locator('#restore-chain').selectOption(value)
        await page.waitForTimeout(200)
        await page.getByRole('button', { name: 'Restore', exact: true }).last().click()
        await page
          .waitForFunction(
            () => /[1-9]\d* active/i.test(document.querySelector('.job-tray')?.innerText ?? ''),
            undefined,
            { timeout: 10_000 },
          )
          .catch(() => undefined)
        await waitJobs()
        await page.waitForTimeout(300)
        const text = await page.locator('#module-content').innerText()
        const outcome = /Applied|snippet|player|done/i.test(text)
          ? 'done'
          : /failed|error|not installed|unavailable/i.test(text)
            ? 'error'
            : 'unknown'
        console.log(`restore ${value}: ${outcome}`)
        if (outcome === 'unknown') throw new Error(`restore ${value} produced no status`)
      }
    })
  }

  if (only === 'separate-presets') {
    await step('separate presets', async () => {
      await rail('Separate').click()
      const values = ['vocals', 'harmonic', 'drums', 'karaoke', '4stem']
      for (const value of values) {
        await page.locator('#sep-preset').selectOption(value)
        await page.locator('#sep-tier').selectOption('draft')
        await page.waitForTimeout(200)
        await page.getByRole('button', { name: 'Separate', exact: true }).last().click()
        await page
          .waitForFunction(
            () => /[1-9]\d* active/i.test(document.querySelector('.job-tray')?.innerText ?? ''),
            undefined,
            { timeout: 10_000 },
          )
          .catch(() => undefined)
        await waitJobs()
        await page.waitForTimeout(300)
        const text = await page.locator('#module-content').innerText()
        const ready = /Stems ready/i.test(text)
        const error = /failed|error|not installed|unavailable|requires/i.test(text)
        console.log(`separate ${value}: ${ready ? 'stems' : error ? 'error' : 'unknown'}`)
        if (!ready && !error) throw new Error(`separate ${value} produced no result`)
      }
    })
  }

  if (only === 'all' || only === 'separate') {
    await step('separate DSP fallback', async () => {
      await rail('Separate').click()
      await page.getByRole('button', { name: 'Separate', exact: true }).last().click()
      await waitJobs()
      const ready = page.getByText(/Stems ready/i).first()
      await ready.waitFor({ timeout: 60_000 })
      await ready.scrollIntoViewIfNeeded()
      const text = await page.locator('#module-content').innerText()
      if (!/vocals/i.test(text) || !/instrumental/i.test(text)) {
        throw new Error('stem result missing vocals/instrumental')
      }
      await page.getByRole('button', { name: /Send stems to Studio/i }).first().click()
      await page.waitForTimeout(600)
      await rail('Studio').click()
      await page.waitForTimeout(600)
      const studio = await page.locator('#module-content').innerText()
      if (!/Vocals/i.test(studio) || !/Instrumental/i.test(studio)) {
        throw new Error('stems did not reach Studio')
      }
      console.log('SEPARATE RESULT:', text.slice(-300).replace(/\n+/g, ' | '))
      await rail('Separate').click()
      await page.waitForTimeout(300)
    })
  }

  if (only === 'all' || only === 'midi') {
    await step('midi transcription', async () => {
      await rail('MIDI').click()
      await page.getByRole('button', { name: 'Transcribe', exact: true }).first().click()
      await waitJobs()
      const text = await page.locator('#module-content').innerText()
      console.log('MIDI RESULT:', text.slice(0, 600).replace(/\n+/g, ' | '))
      if (/No notes|failed/i.test(text)) throw new Error('transcription produced no notes')
    })

    await step('midi practice mode', async () => {
      const practiceButton = page.locator('#module-content button').filter({ hasText: 'Practice' }).first()
      await practiceButton.waitFor({ timeout: 30_000 })
      await practiceButton.click()
      await page.waitForTimeout(800)
      const practice = page.locator('#module-content')
      const text = await practice.innerText()
      if (!/practice|wait|count/i.test(text)) throw new Error('practice view did not render')
      if (!/phase[- ]vocoder/i.test(text)) throw new Error('method label missing')
      if (!/never a commercial stretcher/i.test(text)) throw new Error('honesty label missing')
      const playButton = practice.getByRole('button', { name: 'Play', exact: true }).first()
      await playButton.click()
      await practice.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 10_000 })
      await practice.getByRole('button', { name: 'Pause', exact: true }).first().click()
      await practice.locator('button').filter({ hasText: 'A–B loop' }).first().click()
      await practice.locator('button').filter({ hasText: 'Set A' }).first().click()
      await practice.getByRole('button', { name: 'Set B', exact: false }).first().click()
      await page.waitForTimeout(300)
      console.log('PRACTICE TEXT:', text.slice(0, 300).replace(/\n+/g, ' | '))
      console.log('PRACTICE CONTROLS:', JSON.stringify(await practice.evaluate((root) => [...root.querySelectorAll('button, input, select')].slice(0, 30).map((el) => ({ tag: el.tagName, type: el.type, text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40), checked: el.checked })))))
    })
  }

  if (only === 'all' || only === 'midi-edit') {
    await step('midi edit and score views', async () => {
      await rail('MIDI').click()
      await page.locator('#module-content button').filter({ hasText: /^Edit$/ }).first().click()
      await page.waitForTimeout(500)
      const editText = await page.locator('#module-content').innerText()
      if (!/roll|notes/i.test(editText)) throw new Error('edit view did not render')
      await page.locator('#module-content button').filter({ hasText: 'Roll + score' }).first().click()
      await page.waitForTimeout(700)
      const scoreText = await page.locator('#module-content').innerText()
      if (!/Score/i.test(scoreText)) throw new Error('score view did not render')
      console.log('MIDI SCORE:', scoreText.slice(-260).replace(/\n+/g, ' | '))
    })
  }

  if (only === 'all' || only === 'library') {
    await step('library add, note, marker, version', async () => {
      await rail('Library').click()
      await page.getByRole('button', { name: 'Add current file', exact: true }).click()
      await page.getByText(/Songs \(1\)/).waitFor({ timeout: 30_000 })
      await page.locator('#module-content button').filter({ hasText: 'flow-tune.wav' }).first().click()
      await page.locator('#module-content textarea').first().waitFor({ timeout: 20_000 })
      const note = page.locator('#module-content textarea').first()
      await note.fill('QA note for the flow tune')
      await page.getByRole('button', { name: /Save note/i }).first().click()
      await page.waitForTimeout(400)
      await page.waitForTimeout(500)
      const savedValue = await note.inputValue()
      console.log('SAVED VALUE:', JSON.stringify(savedValue))
      if (savedValue !== 'QA note for the flow tune') throw new Error(`note did not persist in the field: ${JSON.stringify(savedValue)}`)
      const text = await page.locator('#module-content').innerText()
      if (!/saved/i.test(text)) throw new Error('no saved confirmation')
      const markerTime = page.getByLabel(/Marker time/i)
      await markerTime.fill('2')
      const markerLabel = page.getByLabel(/Marker label/i)
      await markerLabel.fill('QA marker')
      console.log('MARKER LABEL BEFORE:', await markerLabel.inputValue())
      await page.locator('#module-content button').filter({ hasText: 'Add marker' }).last().click()
      await page.waitForTimeout(700)
      console.log('MARKER LABEL AFTER:', await markerLabel.inputValue())
      console.log('LIBRARY TEXT:', (await page.locator('#module-content').innerText()).slice(-500).replace(/\n+/g, ' | '))
      const afterMarker = await page.locator('#module-content').innerText()
      if (!afterMarker.includes('QA marker')) throw new Error('marker was not added')

      await page.locator('#module-content button').filter({ hasText: 'Save version' }).first().click()
      await page.waitForTimeout(500)
      const afterVersion = await page.locator('#module-content').innerText()
      if (!/QA scene/.test(afterVersion)) throw new Error('version was not saved')

      await page.getByLabel(/Clip start/i).fill('1')
      await page.getByLabel(/Clip end/i).fill('3')
      await page.locator('#module-content button').filter({ hasText: 'Add clip' }).last().click()
      await page.waitForTimeout(500)
      const afterClip = await page.locator('#module-content').innerText()
      if (!/1\.0–3\.0s/.test(afterClip)) throw new Error('clip was not added')

      await page.locator('#module-content button').filter({ hasText: 'Add to Favorites' }).first().click()
      await page.waitForTimeout(900)
      const afterPlaylist = await page.locator('#module-content').innerText()
      console.log('PLAYLIST TEXT:', afterPlaylist.slice(-260).replace(/\n+/g, ' | '))
      if (!/Favorites \(1 songs\)/.test(afterPlaylist)) throw new Error('playlist add failed')

      const exportHref = await page.locator('#module-content a[href="/api/library/export"]').getAttribute('href')
      const exported = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return { status: response.status, size: (await response.blob()).size }
      }, exportHref)
      if (exported.status !== 200 || exported.size < 50) throw new Error('library export failed')
      console.log('LIBRARY EXPORT:', JSON.stringify(exported))

      await page.getByRole('button', { name: 'Reset library', exact: true }).click()
      await page.getByText(/Songs \(0\)/).waitFor({ timeout: 15_000 })
    })
  }

  if (only === 'all' || only === 'prefs') {
    await step('preferences theme, density, scale, models', async () => {
      await rail('Prefs').click()
      await page.locator('#theme').selectOption('light')
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
      await page.locator('#theme').selectOption('high-contrast')
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'high-contrast')
      await page.locator('#theme').selectOption('dark')
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await page.locator('#density').selectOption('compact')
      await page.waitForFunction(() => document.documentElement.dataset.density === 'compact')
      await page.locator('#density').selectOption('comfortable')
      await page.locator('#font-scale').selectOption('125')
      await page.waitForFunction(
        () => document.documentElement.style.getPropertyValue('--font-scale').trim() === '1.25',
      )
      await page.locator('#font-scale').selectOption('100')
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.waitForTimeout(800)
    })
  }

  if (only === 'all' || only === 'shell') {
    await step('shell palette, help, rail, shortcuts', async () => {
      await page.locator('.rail-search').click()
      await page.locator('.palette-input').waitFor({ timeout: 10_000 })
      await page.locator('.palette-input').fill('Studio')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)
      if (!/Studio/.test(await page.locator('#module-content').innerText())) {
        throw new Error('palette did not navigate to Studio')
      }
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(400)
      if ((await page.locator('.palette-input').count()) === 0) {
        throw new Error('Ctrl+K did not open the palette')
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.keyboard.press('?')
      await page.locator('.studio-help-sheet').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await page.locator('.studio-help-sheet').waitFor({ state: 'hidden', timeout: 10_000 })
      await page.keyboard.press('Control+b')
      await page.locator('.shell.rail-collapsed').waitFor({ timeout: 5_000 })
      await page.keyboard.press('Control+b')
      await page.locator('.shell.rail-collapsed').waitFor({ state: 'detached', timeout: 5_000 })
    })
  }

  if (only === 'all' || only === 'player') {
    await step('player overlay play and escape', async () => {
      await rail('Studio').click()
      await page.locator('.studio-track-head').first().click()
      await page.getByRole('button', { name: 'Real-time', exact: true }).click()
      const dialog = page.locator('.realtime-player')
      await dialog.waitFor({ timeout: 10_000 })
      if (!/phase[- ]vocoder/i.test(await dialog.innerText())) throw new Error('method label missing')
      await dialog.getByRole('button', { name: 'Play', exact: true }).first().click()
      await dialog.getByRole('button', { name: 'Pause', exact: true }).first().waitFor({ timeout: 10_000 })
      const boxes = dialog.locator('input[type=checkbox]')
      await boxes.nth(1).check()
      await boxes.nth(2).check()
      if (!(await boxes.nth(1).isChecked()) || !(await boxes.nth(2).isChecked())) {
        throw new Error('count-in/metronome did not toggle')
      }
      await dialog.getByRole('button', { name: 'Pause', exact: true }).first().click()
      await page.keyboard.press('End')
      await page.waitForTimeout(200)
      await dialog.getByRole('button', { name: 'Set A', exact: false }).first().click()
      await page.keyboard.press('Home')
      await dialog.getByRole('button', { name: 'Set B', exact: false }).first().click()
      const create = dialog.getByRole('button', { name: /Create clip from A/i }).first()
      if (await create.isEnabled()) {
        await create.click()
        await page.waitForTimeout(300)
      }
      await dialog.getByRole('button', { name: /Add marker/i }).first().click()
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached', timeout: 5_000 })
    })
  }

  if (only === 'all' || only === 'import-url') {
    await step('import url rejects loopback', async () => {
      await rail('Import').click()
      await page.locator('#import-url').fill('http://127.0.0.1:9/does-not-exist.wav')
      await page.getByRole('button', { name: /Fetch URL/i }).click()
      await page.waitForFunction(
        () => /blocked|not allowed|private|loopback|failed|error|invalid/i.test(document.body.innerText),
        undefined,
        { timeout: 30_000 },
      )
      const text = await page.locator('#module-content').innerText()
      console.log('IMPORT URL RESULT:', text.slice(0, 400).replace(/\n+/g, ' | '))
    })
  }

  if (only === 'studio-edits') {
    await step('studio region edits', async () => {
      await rail('Studio').click()
      await page.locator('.studio-track-head').first().click()
      await page.getByRole('button', { name: 'Select region (V)', exact: true }).click()
      const lane = page.locator('.studio-lane').first()
      const box = await lane.boundingBox()
      if (!box) throw new Error('no lane')
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(300)
      const selected = await page.locator('#module-content').innerText()
      const lines = selected.split('\n')
      const idx = lines.findIndex((line) => /Playhead/i.test(line))
      console.log('PLAYHEAD:', JSON.stringify(lines.slice(Math.max(0, idx - 1), idx + 4)))
      if (!/sel \d+:\d+\.\d+–/.test(selected)) throw new Error('drag made no selection')

      const selectRegion = async () => {
        const laneBox = await lane.boundingBox()
        if (!laneBox) throw new Error('no lane')
        await page.mouse.move(laneBox.x + laneBox.width * 0.2, laneBox.y + laneBox.height * 0.5)
        await page.mouse.down()
        await page.mouse.move(laneBox.x + laneBox.width * 0.6, laneBox.y + laneBox.height * 0.5, { steps: 10 })
        await page.mouse.up()
        await page.waitForTimeout(250)
      }
      for (const op of ['In', 'Out', '+3', 'Norm', 'Rev', 'Trim']) {
        await selectRegion()
        await page.getByRole('button', { name: op, exact: true }).first().click()
        await waitJobs()
        await page.waitForTimeout(300)
        const status = await page.locator('#module-content').innerText()
        if (/Select a region on the active track first/i.test(status)) {
          throw new Error(`${op} ran without a selection`)
        }
      }
      const after = await page.locator('#module-content').innerText()
      console.log('EDIT RESULT:', after.slice(-220).replace(/\n+/g, ' | '))
      if (/failed|error/i.test(after)) throw new Error('an edit reported a failure')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
    })
  }

  if (only === 'studio-paths') {
    await step('restore and separate into Studio', async () => {
      await rail('Restore').click()
      await page.getByRole('button', { name: 'Restore', exact: true }).last().click()
      await waitJobs()
      const openInStudio = page.locator('#module-content button').filter({ hasText: /Open in Studio/i }).first()
      await openInStudio.waitFor({ timeout: 30_000 })
      await openInStudio.click()
      await page.waitForTimeout(800)
      if (!/Studio/.test(await page.locator('#module-content').innerText())) {
        throw new Error('restore did not open Studio')
      }
      const restored = await page.locator('#module-content').innerText()
      if (!/restored|enhanced|dehum/i.test(restored)) throw new Error('restored track not in Studio')

      await rail('Separate').click()
      await page.getByRole('button', { name: 'Separate', exact: true }).last().click()
      await waitJobs()
      const addPack = page.locator('#module-content button').filter({ hasText: /Add as mashup pack/i }).first()
      await addPack.waitFor({ timeout: 60_000 })
      await addPack.click()
      await page.waitForTimeout(800)
      if (!/Studio/.test(await page.locator('#module-content').innerText())) {
        throw new Error('pack did not open Studio')
      }
      const packed = await page.locator('#module-content').innerText()
      if (!/Vocals/i.test(packed) || !/Instrumental/i.test(packed)) {
        throw new Error('pack stems missing in Studio')
      }
    })
  }

  if (only === 'shortcuts') {
    await step('studio keyboard shortcuts', async () => {
      await rail('Studio').click()
      await page.locator('.studio-header h2').click()
      await page.keyboard.press('2')
      await page.waitForTimeout(300)
      if (!/Analysis/.test(await page.locator('#module-content').innerText())) {
        throw new Error('shortcut 2 did not open Analysis')
      }
      await page.keyboard.press('3')
      await page.waitForTimeout(300)
      if (!/Studio/.test(await page.locator('#module-content').innerText())) {
        throw new Error('shortcut 3 did not open Studio')
      }
      await page.keyboard.press('m')
      await page.locator('.studio-mix-drawer').waitFor({ timeout: 5_000 })
      await page.keyboard.press('m')
      await page.locator('.studio-mix-drawer').waitFor({ state: 'detached', timeout: 5_000 })
      await page.keyboard.press('Shift+/')
      await page.locator('.studio-help-sheet').waitFor({ timeout: 5_000 })
      await page.keyboard.press('Escape')
      await page.locator('.studio-help-sheet').waitFor({ state: 'detached', timeout: 5_000 })
    })
  }

  if (only === 'prefs-tools') {
    await step('preferences maintenance actions', async () => {
      await rail('Prefs').click()
      await page.getByRole('button', { name: 'Clear player data', exact: true }).click()
      await page.waitForTimeout(400)
      const clearText = await page.locator('#module-content').innerText()
      if (!/cleared|player/i.test(clearText)) throw new Error('clear player data gave no feedback')
      await page.getByRole('button', { name: 'Clear MIDI mappings', exact: true }).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: 'Flush warm pool', exact: true }).click()
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: 'Flush + clear cache', exact: true }).click()
      await page.waitForTimeout(600)
      const budget = page.locator('#cache-budget')
      await budget.fill('1')
      await page.getByRole('button', { name: 'Apply to engine', exact: true }).click()
      await page.waitForTimeout(900)
      const prefs = await page.evaluate(async () => {
        const response = await fetch('/api/prefs')
        return response.json()
      })
      console.log('PREFS:', JSON.stringify(prefs).slice(0, 260))
      if (String(prefs?.cache_budget_gb ?? '') !== '1') throw new Error('cache budget did not apply')
      await budget.fill('999')
      await page.getByRole('button', { name: 'Apply to engine', exact: true }).click()
      await page.waitForTimeout(800)
      const status = await page.locator('#module-content').innerText()
      if (!/exceed|free space|Couldn/i.test(status)) throw new Error('oversize budget got no warning')
    })
  }

  if (only === 'about') {
    await step('about update check', async () => {
      await rail('About').click()
      await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
      await page.waitForFunction(
        () => /update|desktop|unavailable|failed/i.test(document.getElementById('module-content')?.innerText ?? ''),
        undefined,
        { timeout: 15_000 },
      )
      const text = await page.locator('#module-content').innerText()
      console.log('ABOUT UPDATE:', text.slice(0, 220).replace(/\n+/g, ' | '))
    })
  }

  if (only === 'persist') {
    await step('library resume and open-player preference', async () => {
      await rail('Library').click()
      await page.getByRole('button', { name: 'Add current file', exact: true }).click()
      await page.getByText(/Songs \(1\)/).waitFor({ timeout: 30_000 })
      await page.reload()
      await page.waitForTimeout(1200)
      const resume = page.locator('header button').filter({ hasText: /Resume:/ }).first()
      await resume.waitFor({ timeout: 15_000 })
      await resume.click()
      await page.waitForTimeout(800)
      if (!/Library/.test(await page.locator('#module-content').innerText())) {
        throw new Error('resume did not open the library song')
      }

      await rail('Prefs').click()
      const openPlayer = page.locator('#module-content input[type=checkbox]').first()
      if (!(await openPlayer.isChecked())) await openPlayer.check()
      console.log('OPEN PREF:', await page.evaluate(() => localStorage.getItem('neiro.prefs.openPlayerAfterImport')))
      await rail('Import').click()
      await page.locator('#module-content input[type=file]').first().setInputFiles(wav2)
      await page.waitForTimeout(4000)
      console.log('AFTER IMPORT:', (await page.locator('#module-content').innerText()).slice(0, 200).replace(/\n+/g, ' | '))
      await page.waitForFunction(
        () =>
          /Practice/.test(document.getElementById('module-content')?.innerText ?? '') &&
          /A–B loop/.test(document.getElementById('module-content')?.innerText ?? ''),
        undefined,
        { timeout: 90_000 },
      )
      const practicePlay = page
        .locator('#module-content')
        .getByRole('button', { name: 'Play', exact: true })
        .first()
      await practicePlay.click()
      await page
        .locator('#module-content')
        .getByRole('button', { name: 'Pause', exact: true })
        .first()
        .waitFor({ timeout: 10_000 })
    })
  }

  if (only === 'midi-export' || only === 'tray') {
    // Both need a finished transcription; tray hides it afterwards.
  }

  if (only === 'midi-export') {
    await step('midi export links', async () => {
      await rail('MIDI').click()
      await page.getByRole('button', { name: 'Transcribe', exact: true }).first().click()
      await page.waitForFunction(
        () => /notes .* BPM/i.test(document.getElementById('module-content')?.innerText ?? ''),
        undefined,
        { timeout: 120_000 },
      )
      const xml = page.locator('#module-content a[href*=".musicxml"], #module-content a[download][href*="xml"]').first()
      const href = await xml.getAttribute('href')
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return { status: response.status, size: (await response.blob()).size }
      }, href)
      if (result.status !== 200 || result.size < 100) throw new Error('MusicXML export failed')
      console.log('MIDI XML:', JSON.stringify(result))
    })
  }

  if (only === 'tray') {
    await step('job tray hide and show', async () => {
      const show = page.getByRole('button', { name: 'Show job tray', exact: true })
      const hide = page.getByRole('button', { name: 'Hide job tray', exact: true })
      if ((await show.count()) > 0) await show.click()
      await hide.click({ timeout: 10_000 })
      await show.waitFor({ timeout: 5_000 })
      await show.click()
      await hide.waitFor({ timeout: 5_000 })
    })
  }

  if (only === 'cancel') {
    await step('cancel a running pitch-correct job', async () => {
      await rail('Studio').click()
      await page.locator('.studio-track-head').first().click()
      await page.getByRole('button', { name: 'Pitch correct', exact: true }).click()
      await page.waitForFunction(
        () => /Pitch correct/.test(document.querySelector('.job-tray')?.innerText ?? ''),
        undefined,
        { timeout: 15_000 },
      )
      await page.waitForTimeout(300)
      await page.locator('header button').filter({ hasText: 'Cancel' }).first().click()
      await page.waitForFunction(
        () => /cancelled|cancel failed|Pitch correct cancelled/i.test(document.body.innerText),
        undefined,
        { timeout: 30_000 },
      )
      await waitJobs()
      const text = await page.locator('#module-content').innerText()
      console.log('CANCEL RESULT:', text.slice(-200).replace(/\n+/g, ' | '))
      if (!/cancel/i.test(text)) throw new Error('cancel did not surface')
    })
  }

  if (only === 'session') {
    await step('session save, open, export, new', async () => {
      const menuButton = page.locator('.session-menu > button').first()
      await menuButton.click()
      await page.getByRole('menuitem', { name: 'Save session' }).click()
      const dialog = page.getByRole('dialog', { name: 'Save session' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByLabel('Name').fill('qa-session')
      await dialog.getByLabel(/Notes/i).fill('QA session notes')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog.waitFor({ state: 'detached', timeout: 20_000 })

      await menuButton.click()
      await page.getByRole('menuitem', { name: 'Open session' }).click()
      const openDialog = page.getByRole('dialog', { name: 'Open session' })
      await openDialog.waitFor({ timeout: 10_000 })
      await openDialog.getByLabel('Session').selectOption('qa-session')
      const exportLink = openDialog.locator('a[href*="/api/session/export"]')
      const href = await exportLink.getAttribute('href')
      const exported = await page.evaluate(async (url) => {
        const response = await fetch(url)
        return { status: response.status, size: (await response.blob()).size }
      }, href)
      if (exported.status !== 200 || exported.size < 100) throw new Error('session export failed')
      await openDialog.getByRole('button', { name: 'Open', exact: true }).click()
      await openDialog.waitFor({ state: 'detached', timeout: 30_000 })
      await page.waitForFunction(
        () => !document.querySelector('.shell')?.innerText.includes('No file — Import a track'),
        undefined,
        { timeout: 30_000 },
      )
      console.log('SESSION EXPORT:', JSON.stringify(exported))

      await menuButton.click()
      await page.getByRole('menuitem', { name: 'New session' }).click()
      await page.waitForFunction(
        () => document.querySelector('.shell')?.innerText.includes('No file — Import a track'),
        undefined,
        { timeout: 10_000 },
      )
    })
  }

  if (only === 'queue') {
    await step('import queue shows files and clears', async () => {
      await rail('Import').click()
      await page.locator('#module-content input[type=file]').first().setInputFiles([wav, wav2])
      await page.getByText(/Import queue \(2\)/).waitFor({ timeout: 60_000 })
      await page.getByRole('button', { name: /Clear queue/i }).first().click()
      await page.waitForTimeout(400)
      if (/Import queue/i.test(await page.locator('#module-content').innerText())) {
        throw new Error('queue did not clear')
      }
    })
  }

  if (only === 'dump') {
    for (const label of ['Import', 'Analysis', 'Studio', 'Separate', 'Restore', 'MIDI', 'Library', 'Prefs', 'About']) {
      await rail(label).click()
      await page.waitForTimeout(400)
      const info = await page.evaluate(() => ({
        text: document.querySelector('#module-content')?.innerText.slice(0, 700),
        buttons: [...document.querySelectorAll('#module-content button')]
          .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim())
          .filter(Boolean)
          .slice(0, 40),
        inputs: [...document.querySelectorAll('#module-content input, #module-content select')].map((i) => ({
          type: i.type,
          id: i.id,
          name: i.getAttribute('name'),
          label: i.getAttribute('aria-label'),
          value: i.value?.slice(0, 40),
        })),
      }))
      console.log(`--- ${label} ---`)
      console.log(JSON.stringify(info, null, 1))
    }
  }

  await page.screenshot({ path: join(outDir, 'final.png'), fullPage: true })
  writeFileSync(join(outDir, 'log.json'), JSON.stringify({ log, errors }, null, 2))
  console.log(`page errors: ${errors.length}`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log('shots:', outDir)
} finally {
  await browser?.close().catch(() => {})
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(engine.pid), '/T', '/F'], () => resolve())
  })
}
