import assert from 'node:assert/strict'
import test from 'node:test'
import { getEventListeners } from 'node:events'
import { CapslaneClient, CapslaneError } from '../dist/index.js'

const jobId = 'job_550e8400-e29b-41d4-a716-446655440000'
const accepted = { jobId, status: 'queued', requestId: 'req_accepted' }

test('wait returns content and stops at every terminal state without resubmitting', async () => {
  for (const [status, code] of [['completed', 'transcript_expired'], ['failed', 'transcript_unavailable'], ['cancelled', 'cancelled']]) {
    let calls = 0
    const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async url => {
      calls++
      assert.equal(new URL(url).pathname, '/v1/transcript/' + jobId)
      assert.equal(calls, 1)
      return Response.json({ jobId, status, requestId: 'req_terminal', ...(status === 'failed' ? { error: code } : {}) })
    } })
    await assert.rejects(client.waitForTranscript(accepted, { intervalMs: 1 }), error => {
      assert.ok(error instanceof CapslaneError)
      assert.equal(error.code, code)
      assert.equal(error.status, status === 'completed' ? 410 : 422)
      assert.equal(error.jobId, jobId)
      assert.equal(error.requestId, 'req_terminal')
      return true
    })
  }
  let calls = 0
  const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async () => Response.json(++calls === 1
    ? { jobId, status: 'processing', requestId: 'req_processing' }
    : { jobId, status: 'completed', content: [], requestId: 'req_done' }) })
  assert.deepEqual((await client.waitForTranscript(jobId, { intervalMs: 1 })).content, [])
  assert.equal(calls, 2)
})

test('overall deadline interrupts a delay and an in-flight request with the saved ID', async () => {
  for (const intervalMs of [1000, 1]) {
    let calls = 0
    const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async (_url, { signal }) => {
      calls++
      return new Promise((_resolve, reject) => {
        signal.throwIfAborted()
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    } })
    const started = Date.now()
    await assert.rejects(client.waitForTranscript(accepted, { intervalMs, timeoutMs: 30 }), error =>
      error.code === 'processing_timeout' && error.status === 504 && error.jobId === jobId && error.requestId === 'req_accepted')
    assert.ok(Date.now() - started < 750, 'Deadline must not wait for the full interval or request timeout')
    assert.equal(calls, intervalMs === 1 ? 1 : 0)
  }
})

test('wait preserves diagnostics on HTTP, network, parsing and caller abort failures', async () => {
  for (const failure of ['http', 'network', 'json', 'abort']) {
    const controller = new AbortController()
    const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async () => {
      if (failure === 'http') return Response.json({ error: 'upstream_unavailable', requestId: 'req_http' }, { status: 503 })
      if (failure === 'json') return new Response('not JSON')
      if (failure === 'abort') { controller.abort(Object.freeze(new Error('Caller stopped'))); throw controller.signal.reason }
      throw new TypeError('Synthetic network failure')
    } })
    await assert.rejects(client.waitForTranscript(accepted, { intervalMs: 1, signal: controller.signal }), error =>
      error.jobId === jobId && error.requestId === (failure === 'http' ? 'req_http' : 'req_accepted'))
  }
})

test('successful delays remove abort listeners and invalid timing never contacts the API', async () => {
  let calls = 0
  const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async (_url, { signal }) => {
    calls++
    return Response.json(calls < 15 ? { jobId, status: 'processing' } : { content: [], requestId: 'req_done' })
  } })
  const readJob = client.transcriptJob.bind(client)
  client.transcriptJob = (id, signal) => {
    assert.equal(getEventListeners(signal, 'abort').length, 0)
    return readJob(id, signal)
  }
  await client.waitForTranscript(jobId, { intervalMs: 1 })
  assert.equal(calls, 15)
  for (const options of [{ intervalMs: 0 }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { intervalMs: 1.5 }]) {
    await assert.rejects(client.waitForTranscript(jobId, options), TypeError)
  }
  assert.equal(calls, 15)
})
