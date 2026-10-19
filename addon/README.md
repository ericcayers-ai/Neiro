# Neiro Companion (optional MV3 addon)

The companion is an **optional** Chrome/Edge extension. Neiro works fully without
it: the desktop/browser app owns the library, the player and the queued engine. The
companion adds real-time transpose for audio playing in a browser tab, plus a
paired hand-off to the local Neiro engine for queued work.

## What it does

- **Real-time tab transpose** (±12 semitones, ±100 cents) with a clean-room
  granular shifter in an offscreen `AudioWorklet`. Audio is processed on this
  machine; nothing is uploaded.
- **Site adapters** for YouTube / YouTube Music, Spotify, SoundCloud, Deezer,
  Apple Music, Tidal and Vimeo, with a generic `<video>`/`<audio>` fallback. Site
  code is injected on demand and run only after the user grants access.
- **Tab Audio fallback** for any other page: captures what the browser is allowed
  to play (no DRM circumvention).
- **Paired queued processing**: enter the 6-digit code shown in Neiro
  (Prefs → Companion) to exchange it for the local API token; then upload a file
  for engine analysis/separation. Queued features are unavailable until paired.

## Permissions and why

| Permission | Why |
|---|---|
| `activeTab` | talk to the current tab after a click |
| `scripting` | inject the site adapter/content script on demand |
| `storage` | settings and the paired token (local only) |
| `sidePanel` | the main UI surface |
| `offscreen` | keep the audio graph alive while the panel is closed |
| `tabCapture` (optional) | request only when the user starts capture |
| loopback host access | talk to the local Neiro engine (pairing, health, upload) |
| site host access (optional) | requested per site, never `<all_urls>` at install |

## Limitations (stated, not hidden)

- **Preview quality**: formants follow pitch; the desktop player's phase vocoder
  and Neiro's rendered jobs are higher quality.
- Protected (EME) streams may not be capturable; the extension does not bypass
  DRM and does not extract protected audio.
- Live-site end-to-end (YouTube/Spotify/SoundCloud) is an owner-run check: it needs
  a real browser profile and logins. Static validation (`node addon/scripts/validate.mjs`)
  proves the manifest, files, permission shape and absence of remote code only.
- Chrome/Edge MV3 first; Firefox/Safari parity is not claimed.
- No accounts, cloud, subscription, share links or artificial slot limits.

## Install (unpacked, developer mode)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this
   `addon/` directory.
2. Open the side panel from the toolbar popup.
3. Click **Start tab capture** (grants `tabCapture` for this moment).
4. To pair: open Neiro → Prefs → Companion, copy the 6-digit code, paste it in the
   panel, click **Pair**.

## Privacy

Audio stays in the browser tab and the local Neiro process. There is no analytics,
no remote configuration and no remote code; the only network calls are to
`http://127.0.0.1:8377` when you pair or upload.
