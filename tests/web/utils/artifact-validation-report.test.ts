import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  readArtifactValidationReport,
  readArtifactValidationReportText
} from '@/utils/artifact-validation-report'
import type { ArtifactValidationView, ArtifactReportChunk } from '@/api/types'

const validation: ArtifactValidationView = {
  id: 'validation',
  changeSetId: 'proposal',
  version: 1,
  state: 'pass',
  progress: {
    readBytes: 100,
    totalBytes: 100,
    readRequired: 1,
    totalRequired: 1,
    remainingRequired: 0
  },
  validatorSessionId: 'validator',
  manifestDigest: 'manifest',
  changeDigest: 'change',
  validationEpoch: 1,
  expiresAt: null,
  report: { verdict: 'pass', findingCount: 1 }
}
const report = {
  verdict: 'pass',
  manifestDigest: 'manifest',
  changeDigest: 'change',
  validatorSessionId: 'validator',
  findings: [
    { artifactId: 'document', quote: 'Текст 🧪', message: 'Complete' }
  ],
  resolutions: ['Reviewed']
}
let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})
function serve(chunks: ArtifactReportChunk[]) {
  globalThis.fetch = async () => {
    const item = chunks.shift()
    assert.ok(item, 'Unexpected report request')
    return new Response(JSON.stringify(item))
  }
}
function chunk(text = JSON.stringify(report)): ArtifactReportChunk {
  return {
    id: validation.id,
    offset: 0,
    totalBytes: new TextEncoder().encode(text).length,
    nextOffset: null,
    text
  }
}
test('reads every UTF-8 chunk before exposing complete structured findings', async () => {
  const text = JSON.stringify(report)
  const split = text.indexOf('🧪') + 2
  const first = text.slice(0, split)
  const offset = new TextEncoder().encode(first).length
  const totalBytes = new TextEncoder().encode(text).length
  serve([
    {
      id: validation.id,
      offset: 0,
      totalBytes,
      nextOffset: offset,
      text: first
    },
    {
      id: validation.id,
      offset,
      totalBytes,
      nextOffset: null,
      text: text.slice(split)
    }
  ])
  assert.deepEqual(await readArtifactValidationReport(validation), {
    verdict: 'pass',
    findings: report.findings,
    resolutions: report.resolutions
  })
})
for (const invalid of [
  { ...chunk(), id: 'another' },
  { ...chunk(), offset: 1 },
  { ...chunk(), totalBytes: 20000000 },
  { ...chunk(), totalBytes: chunk().totalBytes + 1 },
  { ...chunk(), nextOffset: 0 },
  chunk(JSON.stringify({ ...report, changeDigest: 'another' })),
  chunk(JSON.stringify({ ...report, findings: [] })),
  chunk(JSON.stringify({ ...report, resolutions: [42] }))
]) {
  test(
    'rejects incomplete or unrelated report: ' + JSON.stringify(invalid),
    async () => {
      serve([invalid])
      await assert.rejects(readArtifactValidationReport(validation))
    }
  )
}
test('does not read a report while a validator can still change it', async () => {
  serve([])
  await assert.rejects(
    readArtifactValidationReport({ ...validation, state: 'running' }),
    /finish/
  )
})

const markdown = '# Отчёт 🧪\n\nГотово.'
const withText: ArtifactValidationView = {
  ...validation,
  report: {
    verdict: 'pass',
    findingCount: 1,
    text: { sha256: 'digest', bytes: new TextEncoder().encode(markdown).length }
  }
}
test('reads the report text in UTF-8 chunks', async () => {
  const split = markdown.indexOf('🧪') + 2
  const first = markdown.slice(0, split)
  const offset = new TextEncoder().encode(first).length
  const totalBytes = new TextEncoder().encode(markdown).length
  serve([
    {
      id: validation.id,
      offset: 0,
      totalBytes,
      nextOffset: offset,
      text: first
    },
    {
      id: validation.id,
      offset,
      totalBytes,
      nextOffset: null,
      text: markdown.slice(split)
    }
  ])
  assert.equal(await readArtifactValidationReportText(withText), markdown)
})
test('a validation without report text yields no text and no request', async () => {
  serve([])
  assert.equal(await readArtifactValidationReportText(validation), null)
})
test('rejects report text whose size differs from the validation summary', async () => {
  serve([chunk('# Other')])
  await assert.rejects(
    readArtifactValidationReportText(withText),
    /does not match/
  )
})
test('does not read report text while a validator can still change it', async () => {
  serve([])
  await assert.rejects(
    readArtifactValidationReportText({ ...withText, state: 'running' }),
    /finish/
  )
})
