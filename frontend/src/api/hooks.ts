import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelJob, getJob } from './client'
import type { JobKind, JobStatus } from './types'

export function useJobPoller() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef(false)

  const reset = useCallback(() => {
    stopRef.current = true
    setJobId(null)
    setStatus(null)
    setError(null)
  }, [])

  const start = useCallback(async (kind: JobKind, startFn: () => Promise<{ job_id: string }>) => {
    stopRef.current = false
    setError(null)
    setStatus({ status: 'running', kind, progress: ['queued…'] })
    try {
      const { job_id } = await startFn()
      if (stopRef.current) return null
      setJobId(job_id)
      for (;;) {
        if (stopRef.current) return null
        const job = await getJob(job_id)
        setStatus(job)
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          if (job.status === 'error') setError(job.error || 'Job failed')
          if (job.status === 'cancelled') setError('Cancelled.')
          setJobId(null)
          return job
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setJobId(null)
      setStatus(null)
      return null
    }
  }, [])

  const cancel = useCallback(async () => {
    if (!jobId) return
    try {
      await cancelJob(jobId)
    } catch {
      /* best effort */
    }
  }, [jobId])

  useEffect(() => () => {
    stopRef.current = true
  }, [])

  return {
    jobId,
    status,
    error,
    running: status?.status === 'running',
    start,
    cancel,
    reset,
  }
}

export function useLocalPref(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) || fallback
    } catch {
      return fallback
    }
  })
  const set = useCallback(
    (v: string) => {
      setValue(v)
      try {
        localStorage.setItem(key, v)
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [value, set]
}
