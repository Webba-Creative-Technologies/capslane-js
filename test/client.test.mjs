import assert from 'node:assert/strict'
import test from 'node:test'
import { CapslaneClient, CapslaneError } from '../dist/index.js'

test('builds a transcript request without exposing the key in the URL', async () => {
  let observed
  const client = new CapslaneClient({ apiKey: 'vxl_test_secret', fetch: async (url, init) => {
    observed = { url: String(url), headers: init.headers }
    return new Response(JSON.stringify({ content: [], lang: 'en', availableLangs: ['en'], source: 'native', cached: false, requestId: 'req_test' }), { status: 200, headers: { 'content-type': 'application/json' } })
  } })
  const result = await client.transcript({ url: 'dQw4w9WgXcQ', mode: 'native' })
  assert.equal(result.requestId, 'req_test')
  assert.match(observed.url, /mode=native/u)
  assert.doesNotMatch(observed.url, /vxl_test_secret/u)
  assert.equal(observed.headers['x-api-key'], 'vxl_test_secret')
})

test('throws a typed Capslane error', async () => {
  const client = new CapslaneClient({ apiKey: 'vxl_test_secret', fetch: async () => new Response(JSON.stringify({ error: 'invalid_video_id', message: 'Invalid', requestId: 'req_test' }), { status: 400, headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(() => client.transcript({ url: 'invalid' }), (error) => error instanceof CapslaneError && error.code === 'invalid_video_id' && error.requestId === 'req_test')
})
