import { setTimeout as sleep } from 'node:timers/promises'
import { CapslaneClient } from '@webba_tech/capslane'

// Importing this module does not send a request.
export async function resumeTranscript(jobId, {
  apiKey = process.env.CAPSLANE_API_KEY,
  timeoutMs = 20 * 60_000,
  intervalMs = 2_000,
  signal,
  fetch,
} = {}) {
  if (typeof jobId !== 'string' || !/^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(jobId)) {
    throw new TypeError('Use the jobId returned by Capslane')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000) {
    throw new TypeError('timeoutMs must be between 1 and 1200000')
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 60_000) {
    throw new TypeError('intervalMs must be between 1 and 60000')
  }

  let requestId
  try {
    if (!apiKey?.trim()) throw new Error('Set CAPSLANE_API_KEY in the server environment')
    const client = new CapslaneClient({ apiKey, timeoutMs: 45_000, fetch })
    const deadline = AbortSignal.timeout(timeoutMs)
    const waitSignal = signal ? AbortSignal.any([signal, deadline]) : deadline

    while (true) {
      waitSignal.throwIfAborted()
      // The second argument is the AbortSignal itself.
      const result = await client.transcriptJob(jobId, waitSignal)
      requestId = result.requestId ?? requestId
      if ('content' in result) return result
      if (['failed', 'cancelled', 'completed'].includes(result.status)) {
        throw Object.assign(new Error('Job ended without transcript content'), {
          code: result.error ?? (result.status === 'completed' ? 'missing_content' : result.status),
          jobStatus: result.status,
        })
      }
      if (!['queued', 'downloading', 'processing', 'persisting'].includes(result.status)) {
        throw Object.assign(new Error('Unrecognized job response'), { code: 'invalid_job_response' })
      }
      await sleep(intervalMs, undefined, { signal: waitSignal })
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error('Job polling interrupted', { cause })
    // Keep this ID to resume after a temporary interruption.
    throw Object.assign(error, { jobId, requestId: error.requestId ?? requestId })
  }
}
