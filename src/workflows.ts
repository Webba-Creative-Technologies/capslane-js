import { CapslaneError, type CapslaneClient, type TranscriptResult } from './index.js'

export interface SavedTranscriptJob {
  jobId: string
  url: string
  lang?: string
  requestId?: string
}

export type TranscriptAccess = Pick<CapslaneClient, 'transcript' | 'transcriptJob' | 'waitForTranscript'>
export interface WaitOptions { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }
export interface ImportOptions extends WaitOptions {
  url: string
  lang?: string
  mode?: 'native' | 'auto' | 'generate'
  saveJob: (job: SavedTranscriptJob) => Promise<void>
}

export interface ImportedTranscript {
  url: string
  transcript: TranscriptResult
  timestampedText: string
}

const jobPattern = /^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Submit once, persist an accepted job before polling, and format its actual content. */
export async function importTranscript(client: TranscriptAccess, options: ImportOptions): Promise<ImportedTranscript> {
  validateWait(options)
  const url = youtubeUrl(options.url)
  if (typeof options.saveJob !== 'function') throw new TypeError('saveJob must durably store an accepted job')
  options.signal?.throwIfAborted()
  const result = await client.transcript({ url, lang: options.lang, mode: options.mode ?? 'native', text: false, signal: options.signal })
  if ('content' in result) return formatResult(url, result)
  const job = { jobId: result.jobId, url, lang: options.lang, requestId: result.requestId }
  try {
    await options.saveJob(job)
  } catch (cause) {
    throw Object.assign(new Error('Accepted transcript job could not be saved', { cause }), {
      code: 'job_persistence_failed', ...job,
    })
  }
  return resumeTranscript(client, job, options)
}

/** Resume the stored import. This function never submits a video. */
export async function resumeTranscript(client: TranscriptAccess, job: SavedTranscriptJob, options: WaitOptions = {}): Promise<ImportedTranscript> {
  try {
    validateWait(options)
    if (!jobPattern.test(job.jobId)) throw new TypeError('Invalid Capslane job ID')
    const url = youtubeUrl(job.url)
    const result = await client.waitForTranscript(job.jobId, options)
    return formatResult(url, result)
  } catch (cause) {
    const error = cause instanceof Error && Object.isExtensible(cause) ? cause : new Error('Transcript import interrupted', { cause })
    throw Object.assign(error, { jobId: job.jobId, url: job.url, requestId: ('requestId' in error ? error.requestId : undefined) ?? job.requestId })
  }
}

function validateWait(options: WaitOptions) {
  for (const [name, value] of Object.entries({ intervalMs: options.intervalMs ?? 2_000, timeoutMs: options.timeoutMs ?? 1_200_000 })) {
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) throw new TypeError(`${name} must be a positive timer integer`)
  }
}

function youtubeUrl(input: string): string {
  if (typeof input !== 'string') throw new TypeError('A public YouTube URL or video ID is required')
  let id = input.trim()
  if (!/^[\w-]{11}$/u.test(id)) {
    let parsed: URL
    try { parsed = new URL(id) } catch { throw new TypeError('Invalid YouTube URL') }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new TypeError('Invalid YouTube URL')
    const host = parsed.hostname.toLowerCase()
    if (host === 'youtu.be') id = parsed.pathname.slice(1)
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') ?? '' : /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/u.exec(parsed.pathname)?.[1] ?? ''
    } else throw new TypeError('Invalid YouTube host')
  }
  if (!/^[\w-]{11}$/u.test(id)) throw new TypeError('Invalid YouTube video ID')
  return `https://www.youtube.com/watch?v=${id}`
}

function formatResult(url: string, transcript: TranscriptResult): ImportedTranscript {
  try {
    if (!Array.isArray(transcript.content)) throw new TypeError('Timestamped imports require content as an array')
    const timestampedText = transcript.content.map(segment => {
      if (typeof segment.text !== 'string' || !Number.isFinite(segment.offset) || segment.offset < 0 || !Number.isFinite(segment.duration) || segment.duration < 0) {
        throw new TypeError('Invalid timestamped transcript content')
      }
      const seconds = Math.floor(segment.offset / 1000)
      const stamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
      return `[${stamp}] ${segment.text}`
    }).join('\n')
    return { url, transcript, timestampedText }
  } catch (cause) {
    throw Object.assign(new CapslaneError(502, 'invalid_transcript_content', transcript.requestId, 'Could not format timestamped content', transcript.jobId), { cause })
  }
}
