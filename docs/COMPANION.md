# Companion (optional browser addon)

`addon/` is an optional MV3 Chrome/Edge companion. Neiro is fully usable without
it; no core feature requires it.

## What exists

- **Manifest** (`addon/manifest.json`): MV3, minimum Chrome 127, permissions
  `activeTab`, `offscreen`, `scripting`, `storage`, `sidePanel`, `contextMenus`;
  `tabCapture` is optional and requested only when capture starts; host access is
  optional and requested per site (never `<all_urls>` at install).
- **Service worker** (`addon/src/service-worker.js`): side panel, one offscreen
  document, capture start/stop, permission request, pairing, queued uploads.
- **Side panel** (`addon/src/sidepanel/`): transpose/fine-pitch sliders, bypass,
  capture start/stop, media state, pairing form, queued upload.
- **Offscreen audio** (`addon/src/offscreen/`): tab stream → clean-room granular
  shifter worklet → destination. Chrome mutes the tab's own output during capture,
  so there is no double audio.
- **Adapters** (`addon/src/adapters/adapters.js`): YouTube/YouTube Music, Spotify,
  SoundCloud, Deezer, Apple Music, Tidal, Vimeo, plus a generic media fallback.
  Injected on demand together with `src/content/content.js`.
- **Capture worklet** (`addon/src/audio/capture-worklet.js`): delay-line pitch
  shifter with triangular cross-fades; preview grade; formants follow pitch.

## Pairing

1. Neiro → Prefs → **Companion**: a 6-digit code is shown (10-minute TTL).
2. In the panel: paste the code, click **Pair**.
3. The extension `POST /api/pair` (JSON, `chrome-extension://` origin) and stores
   the returned token in `chrome.storage.local`. The code rotates after use.
4. Queued features are gated on the stored token; the normal app UI never needs it.

`GET /api/pair/code` is same-origin only (cross-site fetches get 403), and the code
is worthless without loopback access to the machine.

## Privacy and store posture

- Audio is processed in the offscreen document; it is never uploaded. The only
  network calls are to `http://127.0.0.1:8377` for pairing/queued upload.
- No analytics, no remote code (validated statically), no bundled third-party
  scripts, no remote configuration.
- No DRM bypass: only audio the browser is allowed to play is captured; protected
  (EME) streams may yield silence and are documented as a limitation.

## Validation and what is not proven

```powershell
node addon/scripts/validate.mjs     # manifest, files, permissions, no remote code
node --test addon/tests/capture.test.mjs
```

**Not proven here:** live-site end-to-end (YouTube/Spotify/SoundCloud) requires a
real browser profile and logins, so it remains an owner-run check. Capture
revocation, ad-wait timing and audio quality on each site are also owner-run. The
static validator cannot prove runtime behaviour.
