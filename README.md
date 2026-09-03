# Capslane JavaScript SDK

The Capslane JavaScript SDK retrieves YouTube transcripts from Node.js and TypeScript applications. It returns existing captions when available and can generate a transcript when a video has no usable caption track.

## Requirements

- Node.js 20 or later
- A Capslane API key from the [dashboard](https://capslane.com/api-keys)

## Installation

```bash
npm install @webba_tech/capslane
```

## Retrieve a transcript

```js
import { CapslaneClient } from '@webba_tech/capslane'

const capslane = new CapslaneClient({
  apiKey: process.env.CAPSLANE_API_KEY,
})

const result = await capslane.transcript({
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  mode: 'auto',
})

const transcript = 'jobId' in result
  ? await capslane.waitForTranscript(result)
  : result

console.log(transcript.content)
```

## Check a transcript job

```js
const job = await capslane.transcriptJob('job_00000000-0000-0000-0000-000000000000')
```

`waitForTranscript` polls an accepted job until it completes, fails or reaches the timeout.

```js
const transcript = await capslane.waitForTranscript(job, {
  intervalMs: 2_000,
  timeoutMs: 20 * 60_000,
})
```

## Request options

| Option | Type | Description |
| --- | --- | --- |
| `url` | `string` | Public YouTube URL or 11-character video ID. |
| `lang` | `string` | Optional preferred language code. |
| `mode` | `native`, `auto` or `generate` | Selects how Capslane obtains the transcript. |
| `text` | `boolean` | Returns one text string instead of timestamped segments. |
| `chunkSize` | `number` | Groups transcript segments into larger chunks. |
| `signal` | `AbortSignal` | Cancels the request from your application. |

## Modes

- `native` returns existing captions and never starts speech transcription.
- `auto` uses existing captions first and generates a transcript only when needed.
- `generate` creates a transcript from the video audio.

## Errors

Failed requests throw `CapslaneError`. The error includes the HTTP status, Capslane error code and request ID when available.

```js
import { CapslaneError } from '@webba_tech/capslane'

try {
  await capslane.transcript({ url: 'invalid' })
} catch (error) {
  if (error instanceof CapslaneError) {
    console.error(error.status, error.code, error.requestId)
  }
}
```

## Security

Use Capslane from a trusted server. Do not expose API keys in browser code, public repositories or client-side environment variables.

## Links

- [Documentation](https://capslane.com/docs)
- [API reference](https://capslane.com/api-reference)
- [Dashboard](https://capslane.com/dashboard)
- [GitHub](https://github.com/Webba-Creative-Technologies/capslane-js)

## License

MIT
