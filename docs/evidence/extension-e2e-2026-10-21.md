# Companion extension end-to-end — 2026-10-21

Real Chromium (Playwright, headed) with the unpacked MV3 extension, against a
Neiro engine on an **OS-chosen port**.

```powershell
cd frontend
npm run test:extension
```

Measured run:

```json
{
  "extensionId": "phddkifcciabcbdpjfkpokkaaignnhhg",
  "port": 49879,
  "queued": "Uploaded. Engine analysis: A minor."
}
PASS: companion paired, health-checked and uploaded to the dynamic-port engine
```

## What this found

1. **Hardcoded 8377.** The desktop now uses a dynamic port, so the companion could
   never reach it. The panel has an **Engine URL** field (stored in
   `chrome.storage.local`), validated to loopback only, and Prefs shows the live
   origin to paste.
2. **“empty upload”.** The queued file was sent as an `ArrayBuffer` through
   `chrome.runtime.sendMessage`; runtime messages use JSON serialization, so the
   worker received `{}` and the engine returned 400. The panel now POSTs the file
   directly to `/api/upload` with the stored token.

## Not covered

Tab capture and site adapters (the panel is opened as a tab here, not attached as a
side panel; `tabCapture` needs the side-panel gesture/permission), ad wait, and
live streaming sites remain owner-run.
