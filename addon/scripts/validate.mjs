#!/usr/bin/env node
/**
 * Static validation for the optional Neiro Companion.
 *
 * It is deliberately not a browser test: it proves the manifest shape, that every
 * referenced file exists, that no remote code/eval is present, that permissions are
 * the minimum advertised, and that the DSP artefact is local. Live-site capture
 * remains an owner-run check (documented in docs/COMPANION.md).
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []

function check(label, condition, detail = '') {
  if (condition) passes.push(label)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

const manifest = JSON.parse(read('manifest.json'))
check('manifest is MV3', manifest.manifest_version === 3)
check('minimum Chrome 127', Number(manifest.minimum_chrome_version) >= 127)
check('name/version present', Boolean(manifest.name && manifest.version))
check('service worker declared', Boolean(manifest.background?.service_worker))
check('side panel declared', Boolean(manifest.side_panel?.default_path))

const requiredPermissions = ['activeTab', 'offscreen', 'scripting', 'storage', 'sidePanel']
for (const permission of requiredPermissions) {
  check(`permission ${permission}`, (manifest.permissions || []).includes(permission))
}
check(
  'tabCapture is optional',
  (manifest.optional_permissions || []).includes('tabCapture') &&
    !(manifest.permissions || []).includes('tabCapture'),
)
check('no <all_urls> at install', !JSON.stringify(manifest.host_permissions || []).includes('<all_urls>'))
check(
  'install-time host access is loopback only',
  (manifest.host_permissions || []).length > 0 &&
    (manifest.host_permissions || []).every((pattern) => /^http:\/\/(127\.0\.0\.1|localhost)\//.test(pattern)),
)
check(
  'broad site access is optional',
  Boolean(manifest.optional_host_permissions?.length),
)

const requiredFiles = [
  'src/service-worker.js',
  'src/sidepanel/index.html',
  'src/sidepanel/panel.js',
  'src/offscreen/offscreen.html',
  'src/offscreen/offscreen.js',
  'src/audio/capture-worklet.js',
  'src/adapters/adapters.js',
  'src/content/content.js',
  'src/popup/index.html',
  'src/popup/popup.js',
  'README.md',
]
for (const file of requiredFiles) check(`file ${file}`, existsSync(join(root, file)))

const scripts = [
  'src/service-worker.js',
  'src/sidepanel/panel.js',
  'src/offscreen/offscreen.js',
  'src/audio/capture-worklet.js',
  'src/adapters/adapters.js',
  'src/content/content.js',
  'src/popup/popup.js',
]
const remote = /https?:\/\/(?!127\.0\.0\.1|localhost)/
for (const file of scripts) {
  const source = read(file)
  check(`no eval in ${file}`, !/\beval\s*\(/.test(source) && !/new\s+Function\s*\(/.test(source))
  check(`no remote code in ${file}`, !remote.test(source), 'only localhost fetches are allowed')
}

const html = ['src/sidepanel/index.html', 'src/offscreen/offscreen.html', 'src/popup/index.html']
for (const file of html) {
  const source = read(file)
  const sources = [...source.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1])
  check(
    `local scripts only in ${file}`,
    sources.every((src) => src.startsWith('./') || src.startsWith('../')),
    sources.join(', '),
  )
}

const worklet = read('src/audio/capture-worklet.js')
check('worklet registers a processor', worklet.includes("registerProcessor('neiro-capture'"))
check('worklet is clean-room (no rb.wasm)', !/rb\.wasm|rubber ?band/i.test(worklet))

const panel = read('src/sidepanel/index.html')
check('panel labels the method', /clean-room/i.test(panel))
check('panel states no DRM bypass', /no DRM bypass/i.test(panel))
check(
  'panel guards capture during ads',
  read('src/sidepanel/panel.js').includes('mediaState.ad'),
)
check(
  'panel exposes site-access diagnostics',
  panel.includes('site-access') && read('src/sidepanel/panel.js').includes('site:info'),
)
check('panel explains optional pairing', /pair/i.test(panel))

for (const label of passes) console.log(`PASS ${label}`)
for (const failure of failures) console.log(`FAIL ${failure}`)
console.log(`\nAddon validation: ${passes.length} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
