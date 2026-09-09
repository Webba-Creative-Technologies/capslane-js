# Capslane JavaScript client reference

This reference describes @webba_tech/capslane 0.1.2. Import CapslaneClient and CapslaneError from the package. Use a trusted server environment with Node.js 20 or later. The [HTTP response contract](http-contract.md) defines response fields, HTTP statuses and accounting.

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

## Check an existing job

```ts
client.transcriptJob(jobId, signal?): Promise<TranscriptResult | TranscriptJob>
```

This method issues one GET /v1/transcript/{jobId}. A completed result has both jobId and content. Check for content first. Completed job content is a segment array, and requestId is required. HTTP 200 also covers pending, failed and cancelled jobs. A valid unknown ID returns job_not_found, including an ID owned by another workspace.

The HTTP contract also permits completed without content when the stored result has expired. The 0.1.2 TranscriptJob status union does not express that case. The client returns the HTTP JSON without runtime validation, so keep the content guard and a finite deadline even when using the declared types.

## Wait for a transcript

```ts
client.waitForTranscript(job, options?): Promise<TranscriptResult>
```

job is a saved job ID string or an accepted TranscriptJob object. options can contain intervalMs, timeoutMs and signal. Their defaults are intervalMs=2000, timeoutMs=1200000 and no caller signal. The helper sleeps before each status read. It returns content when ready and raises CapslaneError with status 422 on failed or cancelled jobs.

A polling deadline raises status 504 and code processing_timeout. It does not cancel the server job. timeoutMs on the constructor and timeoutMs on the wait method control different deadlines: one HTTP request and the polling window. The latter is checked between iterations. Pass a shared AbortSignal when the whole operation needs a single wall-clock deadline, as in the [quickstart](../README.md#retrieve-a-transcript).

## Errors and recovery

CapslaneError provides status, code, requestId and message for API request errors. requestId can be absent on a locally created exception. It is required in successful HTTP job responses. Fetch failures, aborted requests and invalid JSON can throw other error types.

Preserve the accepted ID before waiting. After a local failure, check the same ID with transcriptJob. A new call to transcript is a new submission and can consume another unit. The package has no cancel-job or account method. Stopping an AbortSignal stops the client operation only.
