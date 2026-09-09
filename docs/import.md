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
