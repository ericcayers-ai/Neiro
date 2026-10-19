/**
 * Neiro Companion service worker.
 *
 * Responsibilities: open the side panel, keep one offscreen audio document alive,
 * start/stop tab capture, pair with the local Neiro engine, and proxy queued
 * uploads. No remote code and no telemetry: audio never leaves the machine.
 */

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html'
const NEIRO_BASE = 'http://127.0.0.1:8377'

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {})
  chrome.contextMenus.create({
    id: 'neiro-open-panel',
    title: 'Open Neiro Companion',
    contexts: ['action'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'neiro-open-panel' && tab?.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
})

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    })
    return contexts.length > 0
  }
  return Boolean(globalThis.__neiroOffscreen)
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Process tab audio locally for real-time transpose.',
  })
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

async function ensureCapturePermission() {
  const granted = await chrome.permissions.contains({ permissions: ['tabCapture'] })
  if (granted) return true
  return chrome.permissions.request({ permissions: ['tabCapture'] })
}

async function saveSettings(patch) {
  const stored = await chrome.storage.local.get('settings')
  const settings = { ...(stored.settings || {}), ...patch }
  await chrome.storage.local.set({ settings })
  return settings
}

async function getToken() {
  const stored = await chrome.storage.local.get(['pairedToken', 'pairedAt'])
  return stored.pairedToken || null
}

async function pairWithNeiro(code) {
  const response = await fetch(`${NEIRO_BASE}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `pairing failed (${response.status})`)
  }
  const data = await response.json()
  await chrome.storage.local.set({ pairedToken: data.token, pairedAt: Date.now() })
  return { ok: true, pairedAt: Date.now() }
}

async function uploadQueued(fileBuffer, filename) {
  const token = await getToken()
  if (!token) throw new Error('Pair Neiro before queued processing.')
  const response = await fetch(`${NEIRO_BASE}/api/upload`, {
    method: 'POST',
    headers: {
      'X-Neiro-Token': token,
      'X-Filename': filename,
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(fileBuffer),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `upload failed (${response.status})`)
  }
  return response.json()
}

async function startCapture() {
  const tabId = await activeTabId()
  if (tabId == null) throw new Error('No active tab.')
  const permitted = await ensureCapturePermission()
  if (!permitted) throw new Error('Tab capture permission was not granted.')
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
  await ensureOffscreen()
  const stored = await chrome.storage.local.get('settings')
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    op: 'start',
    streamId,
    tabId,
    settings: stored.settings || {},
  })
  await chrome.storage.local.set({ capturing: true, captureTab: tabId })
  return { ok: true, tabId }
}

async function stopCapture() {
  await chrome.runtime.sendMessage({ target: 'offscreen', op: 'stop' }).catch(() => {})
  await chrome.storage.local.set({ capturing: false, captureTab: null })
  return { ok: true }
}

async function forwardToTab(message) {
  const tabId = (await chrome.storage.local.get('captureTab')).captureTab ?? (await activeTabId())
  if (tabId == null) return { ok: false, reason: 'no-tab' }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/adapters/adapters.js'] })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/content.js'] })
  } catch (error) {
    return { ok: false, reason: 'no-access', error: String(error) }
  }
  try {
    return await chrome.tabs.sendMessage(tabId, { source: 'neiro-panel', ...message })
  } catch (error) {
    return { ok: false, reason: 'no-content', error: String(error) }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'background') return undefined
  ;(async () => {
    try {
      switch (message.op) {
        case 'capture:start':
          sendResponse(await startCapture())
          break
        case 'capture:stop':
          sendResponse(await stopCapture())
          break
        case 'pitch':
          await chrome.runtime.sendMessage({
            target: 'offscreen',
            op: 'pitch',
            semitones: message.semitones || 0,
            cents: message.cents || 0,
          })
          sendResponse({ ok: true })
          break
        case 'bypass':
          await chrome.runtime.sendMessage({
            target: 'offscreen',
            op: 'bypass',
            value: Boolean(message.value),
          })
          sendResponse({ ok: true })
          break
        case 'settings:set':
          sendResponse({ ok: true, settings: await saveSettings(message.patch || {}) })
          break
        case 'settings:get':
          sendResponse({ ok: true, settings: (await chrome.storage.local.get('settings')).settings || {} })
          break
        case 'pair':
          sendResponse(await pairWithNeiro(message.code))
          break
        case 'pair:status':
          sendResponse({ ok: true, paired: Boolean(await getToken()) })
          break
        case 'pair:clear':
          await chrome.storage.local.remove(['pairedToken', 'pairedAt'])
          sendResponse({ ok: true })
          break
        case 'media':
          sendResponse(await forwardToTab({ op: message.mediaOp, seconds: message.seconds, value: message.value }))
          break
        case 'q:upload':
          sendResponse({ ok: true, report: await uploadQueued(message.buffer, message.filename) })
          break
        case 'panel:open':
          if (message.windowId != null) await chrome.sidePanel.open({ windowId: message.windowId })
          sendResponse({ ok: true })
          break
        default:
          sendResponse({ ok: false, reason: 'unknown-op' })
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
  return true
})
