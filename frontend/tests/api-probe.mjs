/**
 * Live HTTP security probe against the engine (isolated home, 1 MB upload cap).
 * Run: node tests/api-probe.mjs
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const python = join(repo, '.venv', 'Scripts', 'python.exe')
const home = mkdtempSync(join(tmpdir(), 'neiro-probe-'))
const portFile = join(home, 'port.txt')

const engine = spawn(
  python,
  ['-m', 'neiro.cli', 'ui', '--port', '0', '--port-file', portFile, '--no-browser'],
  {
    cwd: repo,
    env: {
      ...process.env,
      LOCALAPPDATA: join(home, 'Local'),
      NEIRO_HOME: join(home, 'cache'),
      NEIRO_MAX_UPLOAD_MB: '1',
    },
    stdio: 'ignore',
  },
)

async function base() {
  for (let i = 0; i < 120; i += 1) {
    if (existsSync(portFile)) {
      const text = readFileSync(portFile, 'utf8').trim()
      if (text) return `http://127.0.0.1:${text}`
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('engine did not start')
}

function raw(port, path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const results = []
function check(name, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected
  results.push({ name, actual, expected, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${actual} (expected ${expected})`)
}

let code = 0
try {
  const origin = await base()
  const port = Number(new URL(origin).port)
  const token = (await (await fetch(origin + '/api/auth/token')).json()).token

  check('health', (await fetch(origin + '/api/health')).status, 200)

  const plain = await fetch(origin + '/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Neiro-Token': token, 'X-Filename': 'x.wav' },
    body: 'not json',
  })
  check('text/plain upload is not accepted as JSON/audio', plain.status, [415, 422])

  const big = new Uint8Array(2 * 1024 * 1024)
  const oversized = await fetch(origin + '/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Neiro-Token': token,
      'X-Filename': 'big.wav',
    },
    body: big,
  })
  check('oversized upload rejected', oversized.status, 413)

  const noToken = await fetch(origin + '/api/edit/job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: 'x', op: 'trim', start: 0, end: 1 }),
  })
  check('mutation without token', noToken.status, 401)

  const badOrigin = await fetch(origin + '/api/edit/job', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Neiro-Token': token,
      Origin: 'http://evil.example',
    },
    body: JSON.stringify({ file_id: 'x', op: 'trim', start: 0, end: 1 }),
  })
  check('cross-origin mutation rejected', badOrigin.status, 403)

  check('non-loopback Host rejected', await raw(port, '/api/health', { Host: 'evil.example' }), 403)

  check('unknown file plan', (await fetch(origin + '/api/plan?file_id=missing&kind=enhance')).status, 400)
  check('unknown job', (await fetch(origin + '/api/job/missing')).status, 404)

  const current = await (await fetch(origin + '/api/session/current')).json()
  check('fresh session has no file', current.file, null)

  code = results.every((row) => row.ok) ? 0 : 1
  console.log(code === 0 ? 'PASS: live API security probe' : 'FAIL: see above')
} catch (error) {
  console.error(String(error))
  code = 1
} finally {
  await new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(engine.pid), '/T', '/F'], () => resolve())
  })
  process.exitCode = code
}
