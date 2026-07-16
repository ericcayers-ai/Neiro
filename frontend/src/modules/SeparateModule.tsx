import { startSeparate } from '../api/client'
import { useLocalPref } from '../api/hooks'
import type { SeparateResult } from '../api/types'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { PlanStrip } from '../components/PlanStrip'
import { SEPARATE_PRESETS, QUALITY_TIERS } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

export function SeparateModule() {
  const {
    file,
    openStudioMix,
    setSeparateResult,
    startEngineJob,
    jobForKind,
    cancelSessionJob,
    analysisCorrections,
  } = useSession()
  const [preset, setPreset] = useLocalPref('neiro.sep.preset', 'vocals')
  const [tier, setTier] = useLocalPref('neiro.sep.tier', 'standard')
  const [bleed, setBleed] = useLocalPref('neiro.sep.bleed', 'auto')
  const job = jobForKind('separate')
  const running = job?.status === 'running'
  const selected = SEPARATE_PRESETS.find((p) => p.value === preset) || SEPARATE_PRESETS[0]
  const selectedTier = QUALITY_TIERS.find((t) => t.value === tier) || QUALITY_TIERS[1]
  const hasCorrections = Boolean(
    analysisCorrections && Object.keys(analysisCorrections.overrides || {}).length,
  )

  const run = async () => {
    if (!file) return
    const done = await startEngineJob({
      kind: 'separate',
      label: `Separate · ${preset} · ${tier}`,
      module: 'separate',
      startFn: () =>
        startSeparate(file.fileId, preset, {
          quality: tier,
          bleed_suppress: bleed,
          corrections: analysisCorrections,
        }),
    })
    if (done?.status === 'done' && done.result) {
      setSeparateResult(done.result as SeparateResult)
      openStudioMix()
    }
  }

  if (!file) {
    return (
      <div className="module-panel">
        <h2>Separate</h2>
        <div className="gate muted">Import a file first — or capture from a DAW injector.</div>
      </div>
    )
  }

  return (
    <div className="module-panel">
      <h2>Separate</h2>
      <p className="lede">
        Run a stem separation job on <strong>{file.name}</strong>. Results open in Studio Mix.
        {hasCorrections
          ? ' Applied Analysis corrections will influence detect-all routing and restore hints.'
          : ''}
      </p>

      <div className="row">
        <IntentField label="Preset" intent={selected.intent} htmlFor="sep-preset">
          <select
            id="sep-preset"
            value={preset}
            disabled={running}
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
            disabled={running}
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
          disabled={running}
          onClick={() => void run()}
          title="Start separation"
        >
          Separate
        </button>
      </div>

      <div className="row" style={{ marginTop: '0.7rem' }}>
        <IntentField
          label="Bleed suppression"
          intent="Post-pass rival-stem leakage control. Off in Draft unless forced."
          htmlFor="sep-bleed"
        >
          <select
            id="sep-bleed"
            value={bleed}
            disabled={running}
            onChange={(e) => setBleed(e.target.value)}
          >
            <option value="auto">Auto (tier policy)</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </IntentField>
      </div>

      <PlanStrip
        kind="separate"
        fileId={file.fileId}
        preset={preset}
        quality={tier}
        bleed={bleed}
      />

      <div className="option-detail" aria-live="polite">
        <div className="option-detail-title">{selected.label}</div>
        <p>{selected.detail}</p>
        <div className="option-detail-title" style={{ marginTop: '0.65rem' }}>
          {selectedTier.label} tier
        </div>
        <p>{selectedTier.detail}</p>
      </div>

      <span className="intent" style={{ marginTop: '0.55rem' }}>
        Separate starts the planner for this preset. Progress lists real pipeline stages — cancel
        stops work on this machine. Jobs keep running if you switch modules.
      </span>

      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />
    </div>
  )
}
