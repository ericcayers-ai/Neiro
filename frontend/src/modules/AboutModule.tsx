import { useEffect, useState } from 'react'
import { fetchVersion } from '../api/client'

export function AboutModule() {
  const [version, setVersion] = useState<string>('…')
  const [updateMsg, setUpdateMsg] = useState('')

  useEffect(() => {
    void fetchVersion()
      .then((v) => setVersion(v.version))
      .catch(() => setVersion('unavailable'))
  }, [])

  const checkUpdates = async () => {
    setUpdateMsg('Checking GitHub Releases…')
    try {
      const res = await fetch('https://api.github.com/repos/ericcayers-ai/Neiro/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const data = (await res.json()) as { tag_name?: string; html_url?: string }
      const latest = (data.tag_name || '').replace(/^v/, '')
      if (!latest) {
        setUpdateMsg('No published release found yet.')
        return
      }
      if (latest === version) {
        setUpdateMsg(`You are on the latest release (${latest}).`)
      } else {
        setUpdateMsg(`Latest is ${latest} (you have ${version}). Open ${data.html_url || 'GitHub Releases'}.`)
      }
    } catch (err) {
      setUpdateMsg(
        `Could not reach GitHub (${err instanceof Error ? err.message : String(err)}). Updates are distributed via GitHub Releases — no telemetry phoning home.`,
      )
    }
  }

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
        <li>DAW injectors (VST2 / CLAP) share one Neiro window for every mode, including capture.</li>
      </ul>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" onClick={() => void checkUpdates()}>
          Check for updates
        </button>
        {updateMsg && (
          <span className="muted" role="status" aria-live="polite">
            {updateMsg}
          </span>
        )}
      </div>

      <h3 style={{ marginTop: 28 }}>Headless / batch</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        These paths are functional today via the CLI (not fake UI stubs). The desktop shell does
        not host a watch-folder daemon panel.
      </p>
      <ul className="muted" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
        <li>
          <strong>Watch folder</strong> —{' '}
          <code>neiro watch ./inbox --out ./done --job separate --preset vocals</code> (also
          <code> transcribe</code> / <code>enhance</code>; <code>--once</code> for a single pass).
        </li>
        <li>
          <strong>DAWproject</strong> — engine helper writes a minimal zip +{' '}
          <code>provenance.json</code> (see <code>neiro.io.dawproject</code>); Studio Mix exports
          stems/WAV/FLAC with sidecar provenance today.
        </li>
      </ul>

      <h3 id="studio-shortcuts" style={{ marginTop: 28 }}>
        Studio shortcuts
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Focus is ignored while typing in a text field. Numeric keys switch modules (1–6;
        7 opens Studio Mix; 8 opens Learn / Practice; 9 Prefs). DAW injectors can focus Learn.
      </p>
      <ul className="muted" style={{ lineHeight: 1.7, paddingLeft: 18 }}>
        <li>
          <strong>Space</strong> — play / pause
        </li>
        <li>
          <strong>V</strong> Select · <strong>A</strong> Scrub · <strong>C</strong> Split tool
        </li>
        <li>
          <strong>Del</strong> silence selection · <strong>Shift+Del</strong> delete / splice
        </li>
        <li>
          <strong>Ctrl+Z</strong> / <strong>Ctrl+Y</strong> undo / redo
        </li>
        <li>
          <strong>[</strong> / <strong>]</strong> nudge selection or clip ±50 ms
        </li>
        <li>
          <strong>Esc</strong> clear selection
        </li>
        <li>
          <strong>=</strong> / <strong>-</strong> zoom · scroll pan · Ctrl+scroll zoom
        </li>
        <li>
          <strong>M</strong> toggle Mix drawer
        </li>
      </ul>
      <p style={{ marginTop: 20 }}>
        <a href="https://github.com/ericcayers-ai/Neiro" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        {' · '}
        <a
          href="https://github.com/ericcayers-ai/Neiro/releases"
          target="_blank"
          rel="noreferrer"
        >
          Releases
        </a>
        {' · '}
        MIT licensed
      </p>
      <p className="faint" style={{ marginTop: 24, fontSize: 12 }}>
        Preferences live under Prefs. Session Save/Open stores portable metadata under ~/.neiro.
      </p>
    </div>
  )
}
