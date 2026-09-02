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
  status: 'queued' | 'downloading' | 'processing' | 'persisting' | 'failed' | 'cancelled'
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
    const jobId = typeof job === 'string' ? job : job.jobId
    const intervalMs = options.intervalMs ?? 2_000
    const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000)
    while (Date.now() < deadline) {
      await delay(intervalMs, options.signal)
      const result = await this.transcriptJob(jobId, options.signal)
      if ('content' in result) return result
      if (result.status === 'failed' || result.status === 'cancelled') {
        throw new CapslaneError(422, result.error ?? result.status, result.requestId, `Transcript job ${result.status}`)
      }
    }
    throw new CapslaneError(504, 'processing_timeout', undefined, 'Transcript job deadline exceeded')
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
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}
