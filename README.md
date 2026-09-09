# Capslane JavaScript SDK

Retrieve transcripts from public YouTube videos. Capslane can return captions immediately or accept a generation job when no usable caption track is available.

## Installation

Use Node.js 22 or later for this example. The package requires Node.js 20 or later. Create a server key in [Capslane API Keys](https://capslane.com/api-keys) and store it in the CAPSLANE_API_KEY environment variable.

```bash
npm install @webba_tech/capslane
```

## Retrieve a transcript

Save this example as transcript-sdk.mjs and run `node transcript-sdk.mjs`. Auto mode can start audio generation. Choose native mode if your first call must never start generation.

```js
import { CapslaneClient, CapslaneError } from '@webba_tech/capslane'

const apiKey = process.env.CAPSLANE_API_KEY
if (!apiKey) throw new Error('Set CAPSLANE_API_KEY')
const client = new CapslaneClient({ apiKey, timeoutMs: 45_000 })
const signal = AbortSignal.timeout(20 * 60_000)

try {
  let result = await client.transcript({ url: 'dQw4w9WgXcQ', mode: 'auto', signal })
  if (!('content' in result)) {
    console.error('Accepted job:', result.jobId)
    result = await client.waitForTranscript(result, { signal })
  }
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (error instanceof CapslaneError) {
    console.error(error.status, error.code, error.requestId)
  }
  throw error
}
```

A ready result contains content. An accepted job contains jobId and a status. Check for content first: a completed job response contains both. The example records the job ID so you can resume waiting after a client failure.

## Method contract

The signature is `client.transcript(options): Promise<TranscriptResult | TranscriptJob>`. Only `options.url` is required. The optional fields are `lang`, `mode`, `text`, `chunkSize` and `signal`. `mode` accepts `native`, `auto` or `generate`; omitting it uses `auto`. `text` defaults to `false`.

`TranscriptResult.content` is `string | TranscriptSegment[]`, with an array of segments by default. An immediate result is a string only when `text: true` was requested. A completed job returns segments even if the initial request asked for text. For example, the default content shape is:

```json
{
  "content": [{ "text": "Example segment.", "offset": 8150, "duration": 1200, "lang": "en" }],
  "lang": "en",
  "availableLangs": ["en"],
  "source": "native",
  "cached": false,
  "requestId": "req_example"
}
```

## Resume an accepted job

Using the client created above, set CAPSLANE_JOB_ID to the accepted job ID and check its state:

```js
const result = await client.transcriptJob(process.env.CAPSLANE_JOB_ID)
const transcript = 'content' in result
  ? result
  : await client.waitForTranscript(result, { timeoutMs: 20 * 60_000 })
```

`transcriptJob` checks once. `waitForTranscript` polls at two-second intervals by default, returns content when ready and raises CapslaneError on a failed or cancelled job. Successful status requests return HTTP 200 even while the job is pending or has failed. Status checks do not reserve another transcript unit.

## Modes, languages and output

Capslane checks the cache before applying the requested mode. Any mode can return cached native or generated content. Inspect source and cached in the response. On a cache miss, native fetches captions without starting audio generation; auto starts generation only after a confirmed absence of usable captions; generate starts or reuses a generation job directly. A temporary upstream error does not trigger the auto fallback.

| Option | Meaning |
| --- | --- |
| url | Public HTTPS YouTube watch, Shorts or youtu.be URL, or an 11-character video ID. |
| lang | Preferred language, such as en or fr-FR. Check the returned lang and availableLangs; this does not request translation. |
| mode | native, auto or generate. Defaults to auto. |
| text | Request one string in an immediate response. Defaults to false. |
| chunkSize | Character budget from 50 to 10,000 for grouping whole segments in an immediate response. |

Segment offset and duration values are milliseconds. An individual source segment may exceed the chunk budget. When text is true, it takes precedence over chunking.

Completed jobs return canonical timestamped segments. The public job endpoint and SDK wait helper do not reapply text or chunk size from the initial request. To obtain plain text from either result shape, place this inside the quickstart's try block, after waiting and before console.log:

```js
const plain = typeof result.content === "string"
  ? result.content
  : result.content.map((segment) => segment.text).join(" ")
```

## Timeouts and errors

The client defaults to a twenty-second network timeout; the quickstart sets `timeoutMs: 45_000`. The wait helper defaults to a twenty-minute polling window, checked between iterations. An in-flight network call has its own timeout. The shared AbortSignal in the quickstart bounds the whole operation, including waits. Stopping a client request does not cancel an accepted server job. Preserve its ID before deciding whether to submit again.

API request failures raise CapslaneError with status, code and requestId. Network, cancellation or response parsing failures may surface separately. The quickstart propagates failures to its caller instead of reporting an incomplete job as a success.

A 429 response may indicate a short rate limit, a concurrency limit or an exhausted allowance. Read the code. Short rate limits use request_failed with Retry-After at the HTTP layer; current SDK errors do not expose that header. Monthly request or generated-minute limits need an allowance change or reset. Apply bounded backoff only where a retry can help, and retry the same job ID when polling. See [errors and retries](https://capslane.com/guides/youtube-transcript-api-errors).

## Authentication and accounting

The client calls https://capslane.com with an x-api-key header. Use it from a trusted server and keep keys out of browser bundles and source control. A dashboard session cookie does not replace an API key.

One transcript request reserves one monthly unit before extraction and cache lookup. Cache hits and later extraction failures can consume that unit. Repeating the initial request can reserve another. Job status and account checks do not consume transcript units. Free workspaces include 50 requests and 15 generated minutes per month, with one active generation; see [current plans](https://capslane.com/pricing).

The current SDK has no account method. Call GET /v1/account with x-api-key to validate a connection and read workspace, plan and monthlyLimit without starting a transcript.

## Reference

Read the [documentation](https://capslane.com/docs), [API reference](https://capslane.com/api-reference) or [Markdown reference](https://capslane.com/api-reference.md). [OpenAPI JSON](https://capslane.com/openapi.json) defines request and response schemas. The [JavaScript integration guide](https://capslane.com/guides/youtube-transcript-api-nodejs) includes a complete HTTP alternative.

## License

MIT
