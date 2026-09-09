# Capslane HTTP response contract

This reference is maintained with the Capslane SDKs. It describes the public v1 API used by JavaScript, Python and other HTTP clients. The [OpenAPI document](https://capslane.com/openapi.json) is the machine-readable schema. The examples below use synthetic content and identifiers.

## Authentication and account

Send a workspace key in the x-api-key header over HTTPS to https://capslane.com. Keep the key in the server environment. A dashboard session does not authenticate these endpoints. The SDKs provide transcript methods; they do not currently provide an account method.

GET /v1/account returns HTTP 200 with workspace, plan and monthlyLimit. It reserves no transcript unit.

```json
{
  "workspace": "Fixture",
  "plan": "free",
  "monthlyLimit": 50
}
```

## Immediate transcript response

GET /v1/transcript requires url, containing a public YouTube URL or an 11-character video ID. mode, lang, text and chunkSize are optional. mode defaults to auto and accepts native, auto or generate. text defaults to false.

A successful immediate response uses HTTP 200. The required fields are content, lang, availableLangs, source, cached and requestId. content is an array of segments by default. Each segment has text, offset, duration and lang; offset and duration are nonnegative integers in milliseconds.

```json
{
  "content": [{ "text": "Synthetic fixture.", "offset": 1000, "duration": 2000, "lang": "en" }],
  "lang": "en",
  "availableLangs": ["en"],
  "source": "generated",
  "cached": true,
  "requestId": "req_example"
}
```

An immediate response to text=true has a string content value. text takes precedence over chunkSize. chunkSize groups whole segments with a character budget from 50 to 10,000, and one source segment can exceed that budget. lang selects a preferred caption language and does not request translation.

## Accepted generation

A submission that accepts a generation job returns HTTP 202. jobId, status and requestId are required. progress is optional. Preserve jobId before waiting so a timeout does not force another submission.

```json
{
  "jobId": "job_550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "requestId": "req_example"
}
```

## Job status response

GET /v1/transcript/{jobId} checks an existing job in the workspace of the key. Successful reads use HTTP 200 for queued, downloading, processing, persisting, completed, failed and cancelled. HTTP 200 alone does not indicate completion. A valid but unknown job ID, including one from another workspace, returns HTTP 404 with error job_not_found.

A response without content requires jobId, status and requestId. progress is an optional integer from 0 to 100. error is an optional code on a failed job. In this example, the generation has failed even though the status request itself succeeded:

```json
{
  "jobId": "job_550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "progress": 50,
  "error": "upstream_unavailable",
  "requestId": "req_example"
}
```

## Completed job response

When stored content is available, a completed job response requires jobId, status, content, lang, availableLangs, source, cached and requestId. status is completed, cached is true, and content is always an array of timestamped segments. requestId is required. The job endpoint does not return plain text, even if the initial submission used text=true. It does not reapply chunkSize either.

```json
{
  "jobId": "job_550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "content": [{ "text": "Synthetic fixture.", "offset": 1000, "duration": 2000, "lang": "en" }],
  "lang": "en",
  "availableLangs": ["en"],
  "source": "generated",
  "cached": true,
  "requestId": "req_example"
}
```

Check for content before checking jobId: this completed response contains both fields. Join segment text locally for plain text after polling.

A completed job can return the status shape without content after its stored result expires. This is not a ready transcript. Bound polling and report the missing content to the caller; never wait indefinitely or automatically submit another generation. The public endpoint still returns HTTP 200 in this case:

```json
{
  "jobId": "job_550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 50,
  "requestId": "req_example"
}
```

## Polling and timeouts

The JavaScript waitForTranscript helper defaults to intervalMs=2000 and timeoutMs=1200000. The Python wait_for_transcript helper defaults to interval=2.0 and timeout=1200. These are finite polling windows. The client network timeout defaults to 20 seconds and applies separately to each HTTP request.

Both helpers sleep before each status read, return when content exists, and raise CapslaneError with status 422 when a job is failed or cancelled. A local polling deadline raises status 504 with code processing_timeout. That error does not prove that the server job failed. Python checks its deadline between iterations; an in-flight request has its own timeout. From JavaScript SDK 0.1.3, the overall wait deadline also aborts in-flight reads and delays. JavaScript accepts an additional caller AbortSignal and stops on completed without content with a local status 410, code transcript_expired and the saved jobId. The public job endpoint still returns HTTP 200 for that state.

Stopping a client does not cancel the server job. To resume, use transcriptJob in JavaScript or transcript_job in Python with the saved ID, then continue bounded polling of that same ID if needed.

## Cache, usage and errors

Cache lookup happens before mode selection. All three modes can return cached native or generated content. On a cache miss, native never starts generation, auto generates only after confirmed missing captions, and generate requests generation directly. A network failure does not count as missing captions. Inspect source and cached in each result.

Each transcript submission reserves a monthly unit before cache lookup and extraction. Cache hits and subsequent extraction failures can consume that unit. Polling and account reads reserve no transcript unit. Repeating a submission can reserve another unit.

API request errors include error, message and requestId. SDK exceptions map these fields to code, message and requestId in JavaScript, or code, message and request_id in Python. A job failure response has its own shape and can provide an error code without a message. Transport or JSON parsing failures may surface separately from HTTP API errors.

Short rate limits use HTTP 429 with request_failed and a Retry-After header. Monthly and generation allowance errors require a different response from temporary network failures. The current SDK exceptions do not expose Retry-After. See the [error guide](https://capslane.com/guides/youtube-transcript-api-errors) before deciding whether to retry.
