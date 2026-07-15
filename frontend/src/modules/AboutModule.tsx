import { useEffect, useState } from 'react'
import { fetchVersion } from '../api/client'

export function AboutModule() {
  const [version, setVersion] = useState<string>('…')

  useEffect(() => {
    void fetchVersion()
      .then((v) => setVersion(v.version))
      .catch(() => setVersion('unavailable'))
  }, [])

  return (
    <div className="module-panel">
      <h2>About / Privacy</h2>
      <p className="lede">
        <strong>Neiro {version}</strong> — local source separation, restoration, and symbolic
        transcription. The interface talks only to a local engine on 127.0.0.1; audio is not
        uploaded to a remote service for processing.
      </p>
      <ul className="muted" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Jobs cancel locally; nothing is queued in the cloud.</li>
        <li>Model weights download only when you install or request them.</li>
        <li>URL fetch (optional yt-dlp) still lands in a local cache under your Neiro home.</li>
        <li>Studio edits are non-destructive: each op writes a new artifact.</li>
        <li>Telemetry is off by default. Crash reports are opt-in only.</li>
      </ul>
      <p style={{ marginTop: 20 }}>
        <a href="https://github.com/ericcayers-ai/Neiro" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        {' · '}
        <a href="/docs/architecture.md" onClick={(e) => e.preventDefault()}>
          Architecture
        </a>
        {' · '}
        MIT licensed
      </p>
      <p className="faint" style={{ marginTop: 24, fontSize: 12 }}>
        Preferences live under Prefs. Session module choice is remembered for this browser tab.
      </p>
    </div>
  )
}
