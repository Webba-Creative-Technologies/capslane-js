import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resumeTranscript } from '../examples/resume-transcript.mjs'
import { CapslaneError } from '../dist/index.js'

const jobId = 'job_550e8400-e29b-41d4-a716-446655440000'
const content = [{ text: 'Synthetic passage.', offset: 12500, duration: 2300, lang: 'en' }]
const completed = { jobId, status: 'completed', content, lang: 'en', availableLangs: ['en'], source: 'generated', cached: false, requestId: 'req_done' }

function fixture(responses, extra = {}) {
  const calls = []
  const options = {
    apiKey: 'fixture-only', intervalMs: 1, timeoutMs: 1000, ...extra,
    fetch: async (input, init) => {
      const url = new URL(input)
      assert.equal(url.origin, 'https://capslane.com')
      assert.equal(url.pathname, '/v1/transcript/' + jobId)
      assert.equal(url.search, '')
      assert.equal(new Headers(init.headers).get('x-api-key'), 'fixture-only')
      assert.ok(init.signal instanceof AbortSignal)
      init.signal.throwIfAborted()
      calls.push(url.pathname)
      assert.ok(responses.length, 'Unexpected extra status request')
      const response = responses.shift()
      return response instanceof Response ? response : Response.json(response)
    },
  }
  return { calls, options }
}

test('resume example uses the published signal signature and reads only the saved job', async () => {
  for (const responses of [[completed], [
    { jobId, status: 'queued', requestId: 'req_queued' },
    { status: 'processing', requestId: 'req_processing' },
    completed,
  ]]) {
    const expectedCalls = responses.length
    const { calls, options } = fixture([...responses])
    assert.deepEqual(await resumeTranscript(jobId, options), completed)
    assert.equal(calls.length, expectedCalls)
  }
})

test('resume example preserves the job and request IDs on terminal and HTTP errors', async () => {
  for (const [response, code] of [
    [{ status: 'failed', error: 'transcript_unavailable' }, 'transcript_unavailable'],
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'completed' }, 'missing_content'],
    [{ status: 'unknown' }, 'invalid_job_response'],
  ]) {
    const { calls, options } = fixture([{ jobId, requestId: 'req_terminal', ...response }])
    await assert.rejects(resumeTranscript(jobId, options), error => {
      assert.equal(error.jobId, jobId)
      assert.equal(error.requestId, 'req_terminal')
      assert.equal(error.code, code)
      return true
    })
    assert.equal(calls.length, 1)
  }
  for (const status of [401, 429, 503]) {
    const { calls, options } = fixture([Response.json({ error: 'fixture_error', requestId: 'req_http' }, { status })])
    await assert.rejects(resumeTranscript(jobId, options), error => {
      assert.ok(error instanceof CapslaneError)
      assert.equal(error.status, status)
      assert.equal(error.jobId, jobId)
      assert.equal(error.requestId, 'req_http')
      return true
    })
    assert.equal(calls.length, 1)
  }
})

test('resume example bounds waits and in-flight reads without losing the accepted ID', async () => {
  const { calls, options } = fixture([{ status: 'processing', requestId: 'req_wait' }], { timeoutMs: 25, intervalMs: 1000 })
  await assert.rejects(resumeTranscript(jobId, options), error => error.jobId === jobId && error.requestId === 'req_wait' && error.name === 'AbortError')
  assert.equal(calls.length, 1)

  const controller = new AbortController()
  let inFlight = 0
  await assert.rejects(resumeTranscript(jobId, {
    apiKey: 'fixture-only', signal: controller.signal,
    fetch: async (_input, init) => {
      inFlight++
      assert.ok(init.signal instanceof AbortSignal)
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        controller.abort(new Error('Caller stopped waiting'))
      })
    },
  }), error => error.jobId === jobId && error.message === 'Caller stopped waiting')
  assert.equal(inFlight, 1)
})

test('resume example validates input before a request and surfaces parsing failures', async () => {
  let calls = 0
  const fetch = async () => { calls++; throw new Error('No request expected') }
  for (const invalid of ['', 'https://example.com', ['job_' + 'a'.repeat(36)]]) {
    await assert.rejects(resumeTranscript(invalid, { apiKey: 'fixture-only', fetch }), TypeError)
  }
  for (const options of [{ timeoutMs: 0 }, { intervalMs: 0 }, { apiKey: '' }]) {
    await assert.rejects(resumeTranscript(jobId, { apiKey: 'fixture-only', fetch, ...options }))
  }
  assert.equal(calls, 0)
  const input = fixture([new Response('Invalid fixture JSON')])
  await assert.rejects(resumeTranscript(jobId, input.options), error => error instanceof SyntaxError && error.jobId === jobId)
  assert.equal(input.calls.length, 1)
})
