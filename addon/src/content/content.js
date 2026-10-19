/* Neiro Companion — on-demand content script. Requires adapters.js injected first. */
/* global NeiroAdapters */
;(function () {
  'use strict'
  if (window.__neiroCompanionContent) return
  window.__neiroCompanionContent = true

  function adapter() {
    return NeiroAdapters ? NeiroAdapters.detect(location.href) : null
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.source !== 'neiro-panel') return undefined
    var current = adapter()
    if (message.op === 'state') {
      sendResponse(NeiroAdapters.state(current))
      return undefined
    }
    if (message.op === 'play') {
      sendResponse({ ok: NeiroAdapters.play(current) })
      return undefined
    }
    if (message.op === 'pause') {
      sendResponse({ ok: NeiroAdapters.pause(current) })
      return undefined
    }
    if (message.op === 'seek') {
      sendResponse({ ok: NeiroAdapters.seek(current, message.seconds) })
      return undefined
    }
    if (message.op === 'muted') {
      sendResponse({ ok: NeiroAdapters.setMuted(current, message.value) })
      return undefined
    }
    sendResponse({ ok: false, reason: 'unknown-op' })
    return undefined
  })

  // Tell the panel the page is ready (it may have loaded before injection).
  try {
    chrome.runtime.sendMessage({ source: 'neiro-content', op: 'ready', site: adapter().id })
  } catch (error) {
    // The panel may be closed; not an error.
  }
})()
