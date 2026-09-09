import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { CapslaneClient } from '@webba_tech/capslane'
import { importTranscript, resumeTranscript } from '@webba_tech/capslane/workflows'

// Node.js 22+. Set CAPSLANE_API_KEY in your server environment.
// Submit: node import-transcript.mjs dQw4w9WgXcQ
// Resume: node import-transcript.mjs --resume ./transcript-jobs/JOB_ID.json
const client = new CapslaneClient({ apiKey: process.env.CAPSLANE_API_KEY ?? '', timeoutMs: 45_000 })
const saveJob = async job => {
  await mkdir('transcript-jobs', { recursive: true, mode: 0o700 })
  if (!/^job_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(job.jobId)) throw new Error('Invalid job ID')
  await writeFile(`transcript-jobs/${job.jobId}.json`, JSON.stringify(job), { mode: 0o600, flag: 'wx', flush: true })
}

try {
  const imported = process.argv[2] === '--resume'
    ? await resumeTranscript(client, JSON.parse(await readFile(process.argv[3], 'utf8')))
    : await importTranscript(client, {
      url: process.argv[2],
      mode: 'native', // Change to auto when audio generation is authorized.
      saveJob, timeoutMs: 20 * 60_000, intervalMs: 2_000,
    })
  console.log(imported.url)
  console.log(imported.timestampedText)
  // Original segments: imported.transcript.content. Offsets and durations are milliseconds.
} catch (error) {
  console.error(JSON.stringify({ error: error.code ?? error.name, jobId: error.jobId, requestId: error.requestId, url: error.url }))
  process.exitCode = 1
}
