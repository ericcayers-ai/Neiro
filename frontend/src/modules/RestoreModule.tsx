import { startEnhance } from '../api/client'
import { useLocalPref } from '../api/hooks'
import type { EnhanceResult } from '../api/types'
import { EmptyGate } from '../components/EmptyGate'
import { IntentField } from '../components/IntentField'
import { JobProgress } from '../components/JobProgress'
import { ModuleHeader } from '../components/ModuleHeader'
import { PlanStrip } from '../components/PlanStrip'
import { RESTORE_CHAINS } from '../constants/options'
import { useSession } from '../state/session'
import './modules.css'

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
        Import a track first, then pick an enhancement chain (or Auto from analysis hints).
      </EmptyGate>
    )
  }

  const result = enhanceResult

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

      <div className="row">
        <IntentField label="Chain" intent={selected.intent} htmlFor="restore-chain">
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
