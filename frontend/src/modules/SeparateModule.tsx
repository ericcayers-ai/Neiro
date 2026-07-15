import { useEffect } from 'react'
import { startSeparate } from '../api/client'
import { useJobPoller, useLocalPref } from '../api/hooks'
import type { SeparateResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { SEPARATE_PRESETS, QUALITY_TIERS } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

export function SeparateModule() {
  const {
    file,
    setModule,
    setSeparateResult,
    setJobRunning,
    setJobLabel,
    registerCancel,
    workspaceMode,
  } = useSession()
  const [preset, setPreset] = useLocalPref('neiro.sep.preset', 'vocals')
  const [tier, setTier] = useLocalPref('neiro.sep.tier', 'standard')
  const [bleed, setBleed] = useLocalPref('neiro.sep.bleed', 'auto')
  const job = useJobPoller()
  const selected = SEPARATE_PRESETS.find((p) => p.value === preset) || SEPARATE_PRESETS[0]
  const selectedTier = QUALITY_TIERS.find((t) => t.value === tier) || QUALITY_TIERS[1]

  useEffect(() => {
    setJobRunning(job.running)
    setJobLabel(job.running ? `Separate · ${preset} · ${tier}` : null)
    registerCancel(job.running ? () => void job.cancel() : null)
    return () => {
      registerCancel(null)
      setJobRunning(false)
      setJobLabel(null)
    }
  }, [job.running, job.cancel, preset, tier, registerCancel, setJobRunning, setJobLabel])

  const run = async () => {
    if (!file) return
    const effective =
      workspaceMode === 'advanced' && tier !== 'standard' ? `${preset}:${tier}` : preset
    const done = await job.start('separate', () => startSeparate(file.fileId, effective))
    if (done?.status === 'done' && done.result) {
      setSeparateResult(done.result as SeparateResult)
      setModule('mixer')
    }
  }

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Separate</h2>
        <div className="gate muted">Import a file first.</div>
      </div>
    )
  }

  return (
    <div className="module-panel">
      <h2>Separate</h2>
      <p className="lede">
        Run a stem separation job on <strong>{file.name}</strong>. Results open in Mixer.
      </p>

      <div className="row">
        <IntentField label="Preset" intent={selected.intent} htmlFor="sep-preset">
          <select
            id="sep-preset"
            value={preset}
            disabled={job.running}
            onChange={(e) => setPreset(e.target.value)}
          >
            {SEPARATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </IntentField>
        <IntentField label="Quality tier" intent={selectedTier.intent} htmlFor="sep-tier">
          <select
            id="sep-tier"
            value={tier}
            disabled={job.running}
            onChange={(e) => setTier(e.target.value)}
          >
            {QUALITY_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </IntentField>
        <button
          type="button"
          className="primary"
          disabled={job.running}
          onClick={() => void run()}
          title="Start separation"
        >
          Separate
        </button>
      </div>

      {workspaceMode === 'advanced' && (
        <div className="row" style={{ marginTop: 10 }}>
          <IntentField
            label="Bleed suppression"
            intent="Post-pass rival-stem leakage control. Off in Draft unless forced."
            htmlFor="sep-bleed"
          >
            <select
              id="sep-bleed"
              value={bleed}
              disabled={job.running}
              onChange={(e) => setBleed(e.target.value)}
            >
              <option value="auto">Auto (tier policy)</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </IntentField>
        </div>
      )}

      <span className="intent" style={{ marginTop: 8 }}>
        Separate starts the planner for this preset. Progress lists real pipeline stages — cancel
        stops work on this machine.
      </span>

      <JobProgress status={job.status} error={job.error} onCancel={() => void job.cancel()} />
    </div>
  )
}
