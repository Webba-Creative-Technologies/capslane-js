export interface TranscriptSegment {
  text: string
  offset: number
  duration: number
  lang: string
}

export interface TranscriptResult {
  content: string | TranscriptSegment[]
  lang: string
  availableLangs: string[]
  source: 'native' | 'generated'
  cached: boolean
  requestId: string
  jobId?: string
  status?: 'completed'
}

export interface TranscriptJob {
  jobId: string
  status: 'queued' | 'downloading' | 'processing' | 'persisting' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  requestId: string
  error?: string
}

export interface TranscriptOptions {
  url: string
  lang?: string
  text?: boolean
  chunkSize?: number
  mode?: 'native' | 'auto' | 'generate'
  signal?: AbortSignal
}

export class CapslaneError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    message = 'Capslane request failed',
    readonly jobId?: string,
  ) {
    super(message)
    this.name = 'CapslaneError'
  }
}

export class CapslaneClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(options: { apiKey: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }) {
    if (!options.apiKey.trim()) throw new TypeError('apiKey is required')
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'https://capslane.com').replace(/\/$/u, '')
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetcher = options.fetch ?? globalThis.fetch
    if (!this.fetcher) throw new TypeError('A fetch implementation is required')
  }

  async transcript(options: TranscriptOptions): Promise<TranscriptResult | TranscriptJob> {
    const query = new URLSearchParams({ url: options.url })
    if (options.lang) query.set('lang', options.lang)
    if (options.text !== undefined) query.set('text', String(options.text))
    if (options.chunkSize !== undefined) query.set('chunkSize', String(options.chunkSize))
    if (options.mode) query.set('mode', options.mode)
    return this.request<TranscriptResult | TranscriptJob>(`/v1/transcript?${query}`, options.signal)
  }

  async transcriptJob(jobId: string, signal?: AbortSignal): Promise<TranscriptResult | TranscriptJob> {
    return this.request<TranscriptResult | TranscriptJob>(`/v1/transcript/${encodeURIComponent(jobId)}`, signal)
  }

  async waitForTranscript(job: TranscriptJob | string, options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TranscriptResult> {
    return waitForTranscript(this, job, options)
  }

  private async request<T>(path: string, callerSignal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      signal,
    })
    const body = await response.json() as T | { error?: string; message?: string; requestId?: string }
    if (!response.ok) {
      const error = body as { error?: string; message?: string; requestId?: string }
      throw new CapslaneError(response.status, error.error ?? 'request_failed', error.requestId, error.message)
    }
    return body as T
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Follow an accepted job through an HTTP or MCP transcript reader. */
export async function waitForTranscript(reader: Pick<CapslaneClient, 'transcriptJob'>, job: TranscriptJob | string, options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TranscriptResult> {
  const jobId = typeof job === 'string' ? job : job.jobId
  const intervalMs = options.intervalMs ?? 2_000
  const timeoutMs = options.timeoutMs ?? 20 * 60_000
  for (const [name, value] of Object.entries({ intervalMs, timeoutMs })) {
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new TypeError(`${name} must be an integer between 1 and 2147483647`)
    }
  }
  let requestId = typeof job === 'string' ? undefined : job.requestId
  const deadline = new AbortController()
  const timeoutError = new CapslaneError(504, 'processing_timeout', undefined, 'Transcript job deadline exceeded', jobId)
  const timer = setTimeout(() => deadline.abort(timeoutError), timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal
  try {
    while (true) {
      await delay(intervalMs, signal)
      const result = await reader.transcriptJob(jobId, signal)
      requestId = result.requestId ?? requestId
      if ('content' in result) return result
      if (result.status === 'completed') {
        throw new CapslaneError(410, 'transcript_expired', requestId, 'The completed job has no stored transcript content', jobId)
      }
      if (result.status === 'failed' || result.status === 'cancelled') {
        throw new CapslaneError(422, result.error ?? result.status, requestId, `Transcript job ${result.status}`, jobId)
      }
    }
  } catch (cause) {
    const error = cause instanceof Error && Object.isExtensible(cause)
      ? cause : new Error('Transcript job polling interrupted', { cause })
    throw Object.assign(error, { jobId, requestId: ('requestId' in error ? error.requestId : undefined) ?? requestId })
  } finally {
    clearTimeout(timer)
  }
}
