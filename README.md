# Capslane JavaScript SDK

Official server-side client for the Capslane YouTube transcript API.

The source release is installable directly from GitHub while npm registry publication is pending.

```bash
npm install github:WebbaLuca/capslane-js#v0.1.1
```

```js
import { CapslaneClient } from '@capslane/sdk'

const capslane = new CapslaneClient({ apiKey: process.env.CAPSLANE_API_KEY })
const result = await capslane.transcript({ url: 'dQw4w9WgXcQ', mode: 'auto' })
const transcript = 'jobId' in result ? await capslane.waitForTranscript(result) : result
```

Keep the API key on a trusted server. See [Capslane documentation](https://capslane.com/docs) for the complete contract.
