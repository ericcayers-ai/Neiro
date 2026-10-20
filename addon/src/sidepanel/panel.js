/* Neiro Companion side panel. */

const $ = (id) => document.getElementById(id)
const DEFAULT_ENGINE_URL = 'http://127.0.0.1:8377'

function normalizeEngineUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(trimmed) ? trimmed : ''
}

async function loadEngineUrl() {
  const stored = await chrome.storage.local.get('engineUrl')
  $('engine-url').value = stored.engineUrl || DEFAULT_ENGINE_URL
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ target: 'background', ...message }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(response || { ok: false })
    })
  })
}

void loadEngineUrl()

async function refreshStatus() {
  const [settings, paired] = await Promise.all([
    send({ op: 'settings:get' }),
    send({ op: 'pair:status' }),
  ])
  const values = settings.settings || {}
  $('transpose').value = String(values.transpose ?? 0)
  $('cents').value = String(values.cents ?? 0)
  $('bypass').checked = Boolean(values.bypass)
  updateLabels()
  $('pair-dot').classList.toggle('paired', Boolean(paired.paired))
  $('pair-status').textContent = paired.paired
    ? 'Paired with the local Neiro engine.'
    : 'Not paired. Show the code in Neiro → Prefs → Companion.'
  const site = await send({ op: 'site:info' })
  $('site-access').textContent = site.origin
    ? `site access: ${site.origin} · ${site.granted ? 'granted' : 'not granted'}`
    : 'site access: open an http(s) page'
  $('site-grant').disabled = !site.origin || site.granted

  const media = await send({ op: 'media', mediaOp: 'state' })
  if (media && media.ok && media.ok !== false && media.hasMedia) {
    $('site').textContent = `${media.label}: ${media.title || 'untitled'}`
    $('media-state').textContent = media.ad
      ? 'ad playing — capture waits for media'
      : `${Math.floor(media.time)}s / ${Math.floor(media.duration)}s`
  } else if (media && media.reason) {
    $('site').textContent = 'This page'
    $('media-state').textContent =
      media.reason === 'no-media' ? 'no media element — Tab Audio fallback' : media.reason
  }
}

function updateLabels() {
  $('transpose-value').textContent = `${$('transpose').value} st`
  $('cents-value').textContent = `${$('cents').value}¢`
}

async function pushPitch() {
  const transpose = Number($('transpose').value) || 0
  const cents = Number($('cents').value) || 0
  updateLabels()
  await send({ op: 'pitch', semitones: transpose, cents })
  await send({ op: 'settings:set', patch: { transpose, cents } })
}

$('site-grant').addEventListener('click', async () => {
  const site = await send({ op: 'site:info' })
  if (!site.origin) {
    $('site-access').textContent = 'site access: open an http(s) page'
    return
  }
  const granted = await chrome.permissions.request({ origins: [`${site.origin}/*`] })
  $('site-access').textContent = `site access: ${site.origin} · ${granted ? 'granted' : 'denied'}`
  $('site-grant').disabled = Boolean(granted)
})

$('engine-save').addEventListener('click', async () => {
  const url = normalizeEngineUrl($('engine-url').value)
  if (!url) {
    $('engine-url-status').textContent =
      'Use http://127.0.0.1:<port> or http://localhost:<port> (engine URLs only).'
    return
  }
  $('engine-url').value = url
  await chrome.storage.local.set({ engineUrl: url })
  $('engine-url-status').textContent = `Engine URL saved: ${url}`
})

$('transpose').addEventListener('input', () => void pushPitch())
$('cents').addEventListener('input', () => void pushPitch())
$('bypass').addEventListener('change', async () => {
  await send({ op: 'bypass', value: $('bypass').checked })
  await send({ op: 'settings:set', patch: { bypass: $('bypass').checked } })
})

$('capture-start').addEventListener('click', async () => {
  // The label says capture waits for the media; enforce it instead of capturing
  // an advert (adapters expose `ad` from the page state).
  const mediaState = await send({ op: 'media', mediaOp: 'state' })
  if (mediaState && mediaState.ok && mediaState.ad) {
    $('media-state').textContent = 'ad playing — wait for the show to resume'
    return
  }
  $('capture-start').disabled = true
  // The permission request must run in this page, from the user's click.
  const granted = await chrome.permissions.request({ permissions: ['tabCapture'] })
  if (!granted) {
    $('capture-start').disabled = false
    $('media-state').textContent = 'tabCapture permission was not granted'
    return
  }
  const result = await send({ op: 'capture:start' })
  if (result.ok) {
    $('capture-stop').disabled = false
    await send({ op: 'pitch', semitones: Number($('transpose').value), cents: Number($('cents').value) })
    $('media-state').textContent = 'capturing tab audio'
  } else {
    $('capture-start').disabled = false
    $('media-state').textContent = result.error || result.reason || 'capture failed'
  }
})

$('capture-stop').addEventListener('click', async () => {
  await send({ op: 'capture:stop' })
  $('capture-start').disabled = false
  $('capture-stop').disabled = true
  $('media-state').textContent = 'stopped'
})

$('pair').addEventListener('click', async () => {
  const code = $('pair-code').value.trim()
  if (!/^\d{6}$/.test(code)) {
    $('pair-status').textContent = 'Enter the 6-digit code shown in Neiro.'
    return
  }
  const result = await send({ op: 'pair', code })
  $('pair-status').textContent = result.ok
    ? 'Paired. Queued processing is available.'
    : result.error || 'pairing failed'
  $('pair-dot').classList.toggle('paired', Boolean(result.ok))
})

$('engine-check').addEventListener('click', async () => {
  $('engine-status').textContent = 'Checking…'
  const result = await send({ op: 'engine:health' })
  $('engine-status').textContent = result.ok
    ? `Neiro ${result.health?.version || '?'} · ${result.health?.status || 'unknown'}`
    : `Engine unreachable: ${result.error || 'unknown error'}`
})

$('queued-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  $('queued-status').textContent = 'Uploading…'
  // Upload directly from the panel: runtime messages use JSON serialization, so
  // an ArrayBuffer sent through the service worker arrives as {} ("empty upload").
  const stored = await chrome.storage.local.get(['engineUrl', 'pairedToken'])
  const base = normalizeEngineUrl(stored.engineUrl) || DEFAULT_ENGINE_URL
  if (!stored.pairedToken) {
    $('queued-status').textContent = 'Pair Neiro before queued processing.'
    return
  }
  try {
    const response = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: {
        'X-Neiro-Token': stored.pairedToken,
        'X-Filename': file.name,
        'Content-Type': 'application/octet-stream',
      },
      body: await file.arrayBuffer(),
    })
    const data = await response.json().catch(() => ({}))
    $('queued-status').textContent = response.ok
      ? `Uploaded. Engine analysis: ${data.report?.estimated_key || 'done'}.`
      : data.error || `upload failed (${response.status})`
  } catch (error) {
    $('queued-status').textContent =
      error instanceof Error ? `Upload failed: ${error.message}` : 'upload failed'
  }
})

void refreshStatus()
setInterval(() => void refreshStatus(), 4000)
