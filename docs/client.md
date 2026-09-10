# Capslane JavaScript client reference

This reference describes @webba_tech/capslane 0.1.4. Import CapslaneClient and CapslaneError from the package. Use a trusted server environment with Node.js 20 or later. The [HTTP response contract](http-contract.md) defines response fields, HTTP statuses and accounting.

## Constructor

```ts
new CapslaneClient({ apiKey, baseUrl, timeoutMs, fetch })
```

apiKey is the required workspace key. An empty or whitespace-only key throws TypeError. The optional baseUrl defaults to https://capslane.com; timeoutMs defaults to 20000 for each HTTP request. The optional fetch argument supplies a compatible fetch implementation for a server or a test. Construction does not contact the API or validate the key remotely.

## Submit a transcript

```ts
client.transcript(options): Promise<TranscriptResult | TranscriptJob>
```

Only options.url is required. lang, mode, text, chunkSize and signal are optional. mode defaults to auto at the API and accepts native, auto or generate. signal is an AbortSignal. text defaults to false, so immediate content is a segment array. An immediate text:true result has string content. The SDK forwards options to GET /v1/transcript and does not automatically wait for an accepted job.

options.url must identify a public YouTube video: an 11-character ID or a supported HTTPS YouTube URL. Direct audio files and arbitrary media URLs are unsupported. Use this concrete submission example with the client constructed above:

```js
let result = await client.transcript({ url: 'dQw4w9WgXcQ', mode: 'auto', text: false })
if (!('content' in result)) {
  console.error('Accepted job:', result.jobId)
  result = await client.waitForTranscript(result, { timeoutMs: 20 * 60_000 })
}
console.log(result.content)
```

The SDK returns the JSON response body. An immediate HTTP 200 body contains content, lang, availableLangs, source, cached and requestId. An accepted HTTP 202 body contains jobId, status and requestId without content. The [HTTP response contract](http-contract.md) provides complete JSON examples for both cases. A job status read later can contain both content and jobId; check content first.

## Check an existing job

```ts
client.transcriptJob(jobId, signal?): Promise<TranscriptResult | TranscriptJob>
```

The optional second argument is an AbortSignal. Pass the signal directly:

```js
const signal = AbortSignal.timeout(45_000)
const result = await client.transcriptJob(jobId, signal)
```

waitForTranscript uses an options object instead: client.waitForTranscript(jobId, { signal }). For a complete bounded loop that preserves the saved ID and stops on completed without content, use the [resume module](../examples/resume-transcript.mjs) and its [usage example](../README.md#resume-an-accepted-job).

This method issues one GET /v1/transcript/{jobId}. A completed result has both jobId and content. Check for content first. Completed job content is a segment array, and requestId is required. HTTP 200 also covers pending, failed and cancelled jobs. A valid unknown ID returns job_not_found, including an ID owned by another workspace.

The HTTP contract also permits completed without content when the stored result has expired. The TranscriptJob status union includes this case. waitForTranscript stops with a locally created CapslaneError, status 410 and code transcript_expired. The original status endpoint still returned HTTP 200.

## Wait for a transcript

```ts
client.waitForTranscript(job, options?): Promise<TranscriptResult>
```

job is a saved job ID string or an accepted TranscriptJob object. options can contain intervalMs, timeoutMs and signal. Their defaults are intervalMs=2000, timeoutMs=1200000 and no caller signal. The helper sleeps before each status read. It returns content when ready and raises CapslaneError with status 422 on failed or cancelled jobs.

A polling deadline raises status 504 and code processing_timeout. It does not cancel the server job. timeoutMs on the constructor and timeoutMs on the wait method control different deadlines: one HTTP request and the polling window. The polling window bounds both delays and in-flight requests through an abort signal. A custom fetch implementation must honor that signal. intervalMs and timeoutMs must be positive integers no greater than 2147483647. Pass a shared AbortSignal to also include the initial submission, as in the [quickstart](../README.md#retrieve-a-transcript).

## Errors and recovery

CapslaneError provides status, code, requestId and message for API request errors. requestId can be absent on a locally created exception. It is required in successful HTTP job responses. Fetch failures, aborted requests and invalid JSON can throw other error types. waitForTranscript attaches jobId and the last known requestId to polling errors, including deadlines and network failures. Its error status 410 for expired stored content is created locally, not an HTTP status returned by the public job endpoint.

Await durable storage of the accepted ID before waiting. The [submission module](../examples/resume-transcript.mjs) awaits saveJob(jobId) and preserves that ID in a job_persistence_failed error if storage rejects. After a local failure, check the same ID with transcriptJob. A new call to transcript is a new submission and can consume another unit. The package has no cancel-job or account method. Stopping an AbortSignal stops the client operation only.

## Complete timestamped import

SDK 0.1.4 exports a maintained workflow from `@webba_tech/capslane/workflows`. It submits once, awaits `saveJob({ jobId, url, lang, requestId })` when a job is accepted, then polls that ID. The callback must resolve only after durable storage succeeds. The default mode is native; use auto when audio generation is authorized.

`importTranscript(client, { url, mode, saveJob, timeoutMs, intervalMs, signal })` returns `{ url, transcript, timestampedText }`. The original API response is in transcript; its segments are in `transcript.content`. timestampedText is already formatted as `[HH:MM:SS] text`, with offsets converted from milliseconds. It is not a field in the raw HTTP response. Read content before jobId; a completed result can have both.

`resumeTranscript(client, savedJob, { timeoutMs, intervalMs, signal })` resumes the record for that video without submitting it again. Both functions preserve the accepted job ID on storage, network, parsing, formatting and polling failures. Failed, cancelled and completed without content stop the wait. The default polling deadline is twenty minutes; each HTTP request has its own timeout. Saving the record uses your storage system's timeout. A local timeout does not cancel the server job.

Use the [complete runnable example](../examples/import-transcript.mjs) or its [public download](https://capslane.com/examples/import-transcript.mjs). It saves a separate record for each accepted job, including the source URL. It never selects an unrelated saved job automatically. Keep records separate for each tenant in a service and use a durable database instead of the local file callback. The example needs Node.js 22 or later.

```js
import { CapslaneClient } from '@webba_tech/capslane'
import { importTranscript, resumeTranscript } from '@webba_tech/capslane/workflows'

// supply saveJob from your durable storage layer
export async function importVideo(url, saveJob) {
  const client = new CapslaneClient({ apiKey: process.env.CAPSLANE_API_KEY, timeoutMs: 45_000 })
  return importTranscript(client, { url, mode: 'auto', saveJob })
}

export async function resumeVideo(savedJob) {
  const client = new CapslaneClient({ apiKey: process.env.CAPSLANE_API_KEY, timeoutMs: 45_000 })
  return resumeTranscript(client, savedJob)
}
```
