/* Neiro Companion side panel. */

const $ = (id) => document.getElementById(id)

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ target: 'background', ...message }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(response || { ok: false })
    })
  })
}

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

$('transpose').addEventListener('input', () => void pushPitch())
$('cents').addEventListener('input', () => void pushPitch())
$('bypass').addEventListener('change', async () => {
  await send({ op: 'bypass', value: $('bypass').checked })
  await send({ op: 'settings:set', patch: { bypass: $('bypass').checked } })
})

$('capture-start').addEventListener('click', async () => {
  $('capture-start').disabled = true
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

$('queued-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  $('queued-status').textContent = 'Uploading…'
  const buffer = await file.arrayBuffer()
  const result = await send({ op: 'q:upload', buffer, filename: file.name })
  $('queued-status').textContent = result.ok
    ? `Uploaded. Engine analysis: ${result.report?.report?.estimated_key || 'done'}.`
    : result.error || 'upload failed'
})

void refreshStatus()
setInterval(() => void refreshStatus(), 4000)
