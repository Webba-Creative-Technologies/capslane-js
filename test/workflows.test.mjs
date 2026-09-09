import assert from 'node:assert/strict'
import test from 'node:test'
import { CapslaneClient } from '../dist/index.js'
import { importTranscript, resumeTranscript } from '../dist/workflows.js'

const jobId = 'job_550e8400-e29b-41d4-a716-446655440000'
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const job = { jobId, url, lang: 'fr', requestId: 'req_accepted' }
const content = [{ text: 'Synthetic passage.', offset: 12500, duration: 2300, lang: 'fr' }]
const result = { content, lang: 'fr', availableLangs: ['fr'], source: 'generated', cached: false, requestId: 'req_done' }
const wait = { intervalMs: 1, timeoutMs: 1000 }

function fixture(responses) {
  const calls = []
  const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async (input, init) => {
    init.signal.throwIfAborted()
    calls.push(new URL(input))
    assert.ok(responses.length, 'Unexpected extra request')
    const value = responses.shift()
    if (value instanceof Error) throw value
    return value instanceof Response ? value : Response.json(value)
  } })
  return { calls, client }
}

test('complete imports format actual content, including completed content with a job ID', async () => {
  for (const response of [result, { ...result, jobId, status: 'completed' }]) {
    const { client, calls } = fixture([response])
    const imported = await importTranscript(client, { ...wait, url: 'dQw4w9WgXcQ', saveJob: async () => assert.fail('No accepted job') })
    assert.equal(imported.timestampedText, '[00:00:12] Synthetic passage.')
    assert.equal(imported.url, url)
    assert.deepEqual(imported.transcript.content, content)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].searchParams.get('text'), 'false')
    assert.equal(calls[0].searchParams.get('mode'), 'native')
  }
})

test('import awaits a stored job with video context before polling', async () => {
  const { client, calls } = fixture([{ jobId, status: 'queued', requestId: 'req_accepted' }, { status: 'processing' }, result])
  let release
  const saved = new Promise(resolve => { release = resolve })
  const pending = importTranscript(client, { ...wait, url, lang: 'fr', mode: 'auto', saveJob: async value => {
    assert.deepEqual(value, job)
    await saved
  } })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(calls.length, 1)
  release()
  assert.equal((await pending).timestampedText, '[00:00:12] Synthetic passage.')
  assert.deepEqual(calls.map(call => call.pathname), ['/v1/transcript', `/v1/transcript/${jobId}`, `/v1/transcript/${jobId}`])
})

test('storage failures retain the accepted context without polling or resubmitting', async () => {
  const { client, calls } = fixture([{ jobId, status: 'queued', requestId: 'req_accepted' }])
  await assert.rejects(importTranscript(client, { url, saveJob: async () => { throw new Error('Storage failed') } }), error =>
    error.code === 'job_persistence_failed' && error.jobId === jobId && error.url === url && error.requestId === 'req_accepted')
  assert.equal(calls.length, 1)
})

test('resumed terminal, network, HTTP and formatting failures retain context', async () => {
  for (const response of [
    { status: 'failed', error: 'transcript_unavailable' }, { status: 'cancelled' }, { status: 'completed' },
    new Error('Network interrupted'), Response.json({ error: 'quota_fixture' }, { status: 429 }),
    { ...result, content: 'Not timestamped' },
  ]) {
    const { client, calls } = fixture([response])
    await assert.rejects(resumeTranscript(client, job, wait), error => error.jobId === jobId && error.url === url && Boolean(error.requestId))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].pathname, `/v1/transcript/${jobId}`)
  }
})

test('invalid input and invalid deadlines fail before any external request', async () => {
  const { client, calls } = fixture([])
  for (const input of ['https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ', 'https://youtu.be/../../secret', 'invalid', 'file:///dQw4w9WgXcQ']) {
    await assert.rejects(importTranscript(client, { url: input, saveJob: async () => {} }), TypeError)
  }
  await assert.rejects(importTranscript(client, { url, timeoutMs: 0, saveJob: async () => {} }), TypeError)
  await assert.rejects(resumeTranscript(client, { ...job, jobId: '../invalid' }), error => error instanceof TypeError && error.jobId === '../invalid')
  assert.equal(calls.length, 0)
})

test('resumption deadline aborts an in-flight read and retains its saved context', async () => {
  let reads = 0
  const client = new CapslaneClient({ apiKey: 'fixture-only', fetch: async (_url, init) => {
    reads++
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  } })
  await assert.rejects(resumeTranscript(client, job, { intervalMs: 1, timeoutMs: 30 }), error => error.jobId === jobId && error.code === 'processing_timeout' && error.url === url)
  assert.equal(reads, 1)
})
