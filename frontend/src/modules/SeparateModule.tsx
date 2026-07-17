import { useState } from 'react'
import { startSeparate } from '../api/client'
import { useLocalPref } from '../api/hooks'
import type { SeparateResult, StudioPackIntent } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { ModuleHeader } from '../components/ModuleHeader'
import { PlanStrip } from '../components/PlanStrip'
import {
  SEPARATE_PRESET_GROUPS,
  SEPARATE_PRESETS,
  QUALITY_TIERS,
  stemLabel,
} from '../constants/options'
import { stemIcon } from '../constants/stemIdentity'
import { useSession } from '../state/session'
import './modules.css'

function packIntentFromResult(
  result: SeparateResult,
  file: { fileId: string; name: string; report: { estimated_bpm?: number | null; estimated_key?: string | null } },
  mode: 'replace' | 'add',
  alignTo?: { bpm: number | null; key: string | null },
): StudioPackIntent {
  const stems = (result.files || [])
    .filter((f) => f.name !== 'residual' && f.file_id)
    .map((f) => ({ name: f.name, fileId: f.file_id!, url: f.url }))
  return {
    mode,
    name: `${file.name} · stems`,
    sourceFileId: file.fileId,
    sourceUrl: result.source_url,
    bpm: file.report.estimated_bpm ?? null,
    key: file.report.estimated_key ?? null,
    stems,
    alignToBpm: mode === 'add' ? alignTo?.bpm ?? null : null,
    alignToKey: mode === 'add' ? alignTo?.key ?? null : null,
  }
}

export function SeparateModule() {
  const {
    file,
    setFile,
    setSeparateResult,
    separateResult,
    startEngineJob,
    jobForKind,
    cancelSessionJob,
    analysisCorrections,
    queueStudioPack,
    stemPacks,
    importQueue,
  } = useSession()
  const [preset, setPreset] = useLocalPref('neiro.sep.preset', 'vocals')
  const [tier, setTier] = useLocalPref('neiro.sep.tier', 'standard')
  const [bleed, setBleed] = useLocalPref('neiro.sep.bleed', 'auto')
  const [batchMsg, setBatchMsg] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const job = jobForKind('separate')
  const running = job?.status === 'running'
  const selected = SEPARATE_PRESETS.find((p) => p.value === preset) || SEPARATE_PRESETS[0]
  const selectedTier = QUALITY_TIERS.find((t) => t.value === tier) || QUALITY_TIERS[1]
  const hasCorrections = Boolean(
    analysisCorrections && Object.keys(analysisCorrections.overrides || {}).length,
  )
  const doneResult =
    (job?.status === 'done' && (job.result as SeparateResult | undefined)) || separateResult
  const stemEntries = (doneResult?.files || [])
    .filter((f) => f.name !== 'residual')
    .map((f) => ({ raw: f.name, label: stemLabel(f.name), icon: stemIcon(f.name) }))
  const stemNames = stemEntries.map((e) => e.label)

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
    }
  }

  const sendToStudio = (mode: 'replace' | 'add') => {
    if (!file || !doneResult) return
    const align =
      mode === 'add' && stemPacks[0]
        ? { bpm: stemPacks[0].bpm, key: stemPacks[0].key }
        : mode === 'add' && file.report
          ? { bpm: file.report.estimated_bpm ?? null, key: file.report.estimated_key ?? null }
          : undefined
    queueStudioPack(packIntentFromResult(doneResult, file, mode, align))
  }

  const runQueueToPacks = async () => {
    const queue = importQueue.length ? importQueue : file ? [file] : []
    if (queue.length < 2) {
      setBatchMsg('Import 2+ files into the queue (Import → multi-select), then run batch here.')
      return
    }
    setBatchBusy(true)
    setBatchMsg(`Separating ${queue.length} files → mashup packs…`)
    try {
      for (let i = 0; i < queue.length; i++) {
        const f = queue[i]
        setFile(f)
        setBatchMsg(`Separate ${i + 1}/${queue.length}: ${f.name}`)
        const done = await startEngineJob({
          kind: 'separate',
          label: `Separate · ${f.name} · ${preset}`,
          module: 'separate',
          startFn: () =>
            startSeparate(f.fileId, preset, {
              quality: tier,
              bleed_suppress: bleed,
              corrections: analysisCorrections,
            }),
        })
        if (done?.status === 'done' && done.result) {
          const result = done.result as SeparateResult
          setSeparateResult(result)
          const alignTarget =
            i === 0
              ? undefined
              : {
                  bpm: queue[0].report.estimated_bpm ?? null,
                  key: queue[0].report.estimated_key ?? null,
                }
          queueStudioPack(
            packIntentFromResult(result, f, i === 0 ? 'replace' : 'add', alignTarget),
          )
        } else {
          setBatchMsg(`Stopped at ${f.name}: ${done?.error || 'job failed'}`)
          break
        }
      }
      setBatchMsg(`Queue done — ${queue.length} packs sent toward Studio.`)
    } finally {
      setBatchBusy(false)
    }
  }

  if (!file) {
    return (
      <EmptyGate title="Separate">
        Import a track first — or capture from a DAW injector — then pick a stem preset.
      </EmptyGate>
    )
  }

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title="Separate"
        lede={
          <>
            Stem job on <strong>{file.name}</strong>. Send results to Studio as a mix or mashup pack.
            {hasCorrections ? ' Analysis corrections will influence routing.' : ''}
          </>
        }
        actions={
          <>
            <button
              type="button"
              disabled={running || batchBusy || importQueue.length < 2}
              onClick={() => void runQueueToPacks()}
              title="Separate every queued import and add each as a Studio mashup pack"
            >
              Separate queue → packs
            </button>
            <button
              type="button"
              className="primary"
              disabled={running || batchBusy}
              onClick={() => void run()}
              title="Start separation"
            >
              Separate
            </button>
          </>
        }
      />

      <div className="row">
        <IntentField label="Preset" intent={selected.intent} htmlFor="sep-preset">
          <select
            id="sep-preset"
            value={preset}
            disabled={running}
            onChange={(e) => setPreset(e.target.value)}
          >
            {SEPARATE_PRESET_GROUPS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {SEPARATE_PRESETS.filter((p) => p.group === g.id).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
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
      </div>

      <details className="advanced-block">
        <summary>Advanced</summary>
        <div className="advanced-block-body">
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
      </details>

      <PlanStrip
        kind="separate"
        fileId={file.fileId}
        preset={preset}
        quality={tier}
        bleed={bleed}
        connections={selected.connections}
      />

      {batchMsg && (
        <p className="status-line muted" role="status">
          {batchMsg}
        </p>
      )}
      {importQueue.length > 0 && (
        <p className="intent">
          Queue: {importQueue.length} file{importQueue.length === 1 ? '' : 's'} — use{' '}
          <strong>Separate queue → packs</strong> for multi-song mashups.
        </p>
      )}

      <div className="option-detail" aria-live="polite">
        <div className="option-detail-title">{selected.label}</div>
        <p>{selected.detail}</p>
        <p className="intent">{selected.connections}</p>
        <div className="option-detail-title" style={{ marginTop: '0.65rem' }}>
          {selectedTier.label} tier
        </div>
        <p>{selectedTier.detail}</p>
      </div>

      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />

      {doneResult && stemNames.length > 0 && !running && (
        <div className="sep-result-panel" role="status">
          <div className="option-detail-title">Stems ready</div>
          <ul className="sep-stem-badges">
            {stemEntries.map((e) => (
              <li key={e.raw}>
                <span className="stem-badge" data-stem={e.raw.toLowerCase()}>
                  <span className="stem-badge-icon" aria-hidden>
                    {e.icon}
                  </span>
                  {e.label}
                </span>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: '0.75rem', gap: '0.5rem' }}>
            <button
              type="button"
              className="primary"
              onClick={() => sendToStudio('replace')}
              title="Replace the Studio timeline with these stems"
            >
              Send stems to Studio
            </button>
            <button
              type="button"
              onClick={() => sendToStudio('add')}
              title="Append as a new mashup pack (BPM-align when a target pack exists)"
            >
              Add as mashup pack
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
