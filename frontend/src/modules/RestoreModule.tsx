import { useMemo } from 'react'
import { startEnhance } from '../api/client'
import { useLocalPref } from '../api/hooks'
import type { AnalysisReport, EnhanceResult } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { ModuleHeader } from '../components/ModuleHeader'
import { PlanStrip } from '../components/PlanStrip'
import { RESTORE_CHAINS } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

/** Client-side mirror of ``recommend_enhance_chain`` for the Restore why-card. */
function recommendFromReport(report: AnalysisReport): {
  why: string
  presetHint: string
  autoSteps: string[]
} {
  const vc = report.vocal_conditions || {}
  const votes: { step: string; score: number; reason: string }[] = []
  const clip = Number(report.clipping_ratio || 0)
  const notes = (report.notes || []).join(' ').toLowerCase()
  if (clip > 0.0005 || notes.includes('clipping')) {
    votes.push({
      step: 'declip',
      score: 0.7,
      reason: 'Clipping detected — peaks need reconstruction.',
    })
  }
  if (vc.hum_hz) {
    votes.push({
      step: 'dehum',
      score: 0.65,
      reason: `Mains hum around ${vc.hum_hz} Hz — notch it out.`,
    })
  }
  if (notes.includes('click') || notes.includes('crackle') || notes.includes('clipping')) {
    votes.push({
      step: 'declick',
      score: 0.5,
      reason: 'Transient spikes / transfer clicks — light declick cleans them up.',
    })
  }
  if (vc.echo_delay_s != null || (typeof vc.rt60_s === 'number' && vc.rt60_s > 0.55)) {
    const ms = vc.echo_delay_s != null ? Math.round(vc.echo_delay_s * 1000) : null
    votes.push({
      step: 'dereverb',
      score: 0.55,
      reason: ms
        ? `Discrete echo ~${ms} ms — neural dereverb when installed.`
        : `Room reverb (RT60 ~${vc.rt60_s} s) — consider dereverb.`,
    })
  }
  if (report.bandwidth_hz && report.bandwidth_hz < 16000) {
    votes.push({
      step: 'restore',
      score: 0.55,
      reason: `Bandwidth only ~${(report.bandwidth_hz / 1000).toFixed(1)} kHz — More air extends it.`,
    })
  }
  if (notes.includes('noise') || notes.includes('hiss')) {
    votes.push({
      step: 'denoise',
      score: 0.5,
      reason: 'Broadband noise flagged — Old & noisy / denoise helps.',
    })
  }

  votes.sort((a, b) => b.score - a.score)
  const autoSteps = votes
    .filter((v) => ['declip', 'declick', 'dehum'].includes(v.step) && v.score >= 0.35)
    .map((v) => v.step)
  const why =
    votes.length === 0
      ? 'Nothing loud stood out — Auto will leave the file alone or only light-touch DSP.'
      : votes
          .slice(0, 3)
          .map((v) => v.reason)
          .join(' ')

  const stepSet = new Set(votes.filter((v) => v.score >= 0.4).map((v) => v.step))
  let presetHint = 'auto'
  if (stepSet.has('declip') && stepSet.size <= 2) presetHint = 'fix-clipping'
  else if (stepSet.has('restore')) presetHint = 'more-air'
  else if (stepSet.has('denoise') || stepSet.has('declick'))
    presetHint = stepSet.has('denoise') ? 'old-noisy' : 'clean'
  else if (stepSet.has('dehum')) presetHint = 'clean'

  return { why, presetHint, autoSteps }
}

export function RestoreModule() {
  const {
    file,
    enhanceResult,
    setEnhanceResult,
    openInStudio,
    startEngineJob,
    jobForKind,
    cancelSessionJob,
    analysisCorrections,
  } = useSession()
  const [chain, setChain] = useLocalPref('neiro.restore.chain', 'auto')
  const job = jobForKind('enhance')
  const running = job?.status === 'running'
  const selected = RESTORE_CHAINS.find((c) => c.value === chain) || RESTORE_CHAINS[0]
  const hasCorrections = Boolean(
    analysisCorrections && Object.keys(analysisCorrections.overrides || {}).length,
  )

  const recommendation = useMemo(
    () => (file ? recommendFromReport(file.report) : null),
    [file],
  )

  const run = async () => {
    if (!file) return
    const done = await startEngineJob({
      kind: 'enhance',
      label: `Restore · ${chain}`,
      module: 'restore',
      startFn: () => startEnhance(file.fileId, chain, analysisCorrections),
    })
    if (done?.status === 'done' && done.result) {
      setEnhanceResult(done.result as EnhanceResult)
    }
  }

  if (!file) {
    return (
      <EmptyGate title="Restore">
        Import a track first, then pick a layman preset (or Auto from analysis hints).
      </EmptyGate>
    )
  }

  const result = enhanceResult
  const hintLabel =
    RESTORE_CHAINS.find((c) => c.value === recommendation?.presetHint)?.label || 'Auto'

  return (
    <div className="module-panel module-enter">
      <ModuleHeader
        title="Restore"
        lede={
          <>
            Enhancement for <strong>{file.name}</strong> — writes a new artifact; source stays
            untouched.
            {hasCorrections ? ' Analysis corrections feed the auto chain.' : ''}
          </>
        }
        actions={
          <button
            type="button"
            className="primary"
            disabled={running}
            onClick={() => void run()}
            title="Start restoration"
          >
            Restore
          </button>
        }
      />

      {recommendation && (
        <div className="option-detail" aria-live="polite" style={{ marginBottom: '0.75rem' }}>
          <div className="option-detail-title">Recommended: {hintLabel}</div>
          <p>{recommendation.why}</p>
          {recommendation.presetHint !== chain && (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setChain(recommendation.presetHint)}
                title="Switch chain to the detector suggestion"
              >
                Use recommendation
              </button>
            </div>
          )}
        </div>
      )}

      <div className="row">
        <IntentField label="Preset" intent={selected.intent} htmlFor="restore-chain">
          <select
            id="restore-chain"
            value={chain}
            disabled={running}
            onChange={(e) => setChain(e.target.value)}
          >
            {RESTORE_CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </IntentField>
      </div>

      <div className="option-detail" aria-live="polite">
        <div className="option-detail-title">{selected.label}</div>
        <p>{selected.detail}</p>
      </div>

      <PlanStrip kind="enhance" fileId={file.fileId} chain={chain} />

      <JobProgress
        status={job}
        error={job?.error}
        onCancel={job?.status === 'running' ? () => void cancelSessionJob(job.id) : undefined}
      />

      {result && (
        <div style={{ marginTop: '1.25rem' }}>
          {result.file_url ? (
            <>
              <audio controls src={result.file_url} style={{ width: '100%' }} />
              <div className="meta-block">
                Applied: {(result.chain || []).join(' → ') || 'none'}
                <br />
                {(result.notes || []).join(' · ')}
              </div>
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <a className="btn-link primary" href={result.file_url} download>
                  Download
                </a>
                {result.file_id && (
                  <button
                    type="button"
                    onClick={() =>
                      openInStudio(result.file_id!, result.file_url!, `${file.name}.restored`)
                    }
                    title="Load the restored audio in Studio"
                  >
                    Open in Studio
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="meta-block">{(result.notes || ['Nothing to repair.']).join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
