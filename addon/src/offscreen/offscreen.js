/**
 * Offscreen audio document: tab capture -> clean-room shifter -> speakers.
 * Chrome routes the captured tab through this graph and mutes the tab's own
 * output, so there is no double audio.
 */

let context = null
let node = null
let source = null
let stream = null

async function start(streamId) {
  await stop()
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })
  context = new AudioContext({ latencyHint: 'interactive' })
  await context.audioWorklet.addModule(new URL('../audio/capture-worklet.js', import.meta.url))
  node = new AudioWorkletNode(context, 'neiro-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  source = context.createMediaStreamSource(stream)
  source.connect(node)
  node.connect(context.destination)
  await context.resume().catch(() => {})
  return { ok: true, sampleRate: context.sampleRate }
}

async function stop() {
  if (source) {
    try {
      source.disconnect()
    } catch (error) {
      /* already disconnected */
    }
    source = null
  }
  if (node) {
    try {
      node.disconnect()
    } catch (error) {
      /* already disconnected */
    }
    node = null
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  if (context) {
    await context.close().catch(() => {})
    context = null
  }
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return undefined
  ;(async () => {
    try {
      if (message.op === 'start') {
        sendResponse(await start(message.streamId))
      } else if (message.op === 'stop') {
        sendResponse(await stop())
      } else if (message.op === 'pitch' && node) {
        node.port.postMessage({ type: 'pitch', semitones: message.semitones, cents: message.cents })
        sendResponse({ ok: true })
      } else if (message.op === 'bypass' && node) {
        node.port.postMessage({ type: 'bypass', value: message.value })
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: false, reason: 'not-ready' })
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
  return true
})
