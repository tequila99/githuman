import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { MAX_ATTACHMENT_BYTES } from '../../../src/shared/agents/constants.ts'

test('unknown API routes have the same error contract with and without the SPA', async t => {
  const staticRoot = mkdtempSync(join(tmpdir(), 'githuman-error-contract-'))
  writeFileSync(join(staticRoot, 'index.html'), 'fixture SPA')
  t.after(() => rmSync(staticRoot, { recursive: true, force: true }))
  for (const options of [{}, { staticRoot }]) {
    const app = buildApp(options)
    t.after(() => app.close())
    const response = await app.inject('/api/missing')
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), {
      statusCode: 404,
      code: 'GHT_HTTP_NOT_FOUND',
      error: 'Not Found',
      message: 'Route /api/missing not found'
    })
  }
})

test('agent guard and missing resources use typed errors; comment delete remains idempotent', async t => {
  const app = buildApp({ agentPresets: [] })
  t.after(() => app.close())
  const rejected = await app.inject({
    url: '/api/agent/sessions',
    headers: { host: 'hostile.example' }
  })
  assert.equal(rejected.statusCode, 403)
  assert.equal(rejected.json().code, 'GHT_HTTP_FORBIDDEN')
  const missing = await app.inject('/api/agent/sessions/missing')
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().code, 'GHT_HTTP_NOT_FOUND')
  const preset = await app.inject({
    method: 'POST',
    url: '/api/agent/sessions',
    payload: { presetId: 'missing' }
  })
  assert.equal(preset.statusCode, 404)
  assert.equal(preset.json().code, 'GHT_AGENT_PRESET_NOT_FOUND')
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/comments/missing'
  })
  assert.equal(removed.statusCode, 204)
  assert.equal(removed.body, '')
})

test('oversized attachment is rejected by the shared schema before session lookup', async t => {
  const app = buildApp({ agentPresets: [] })
  t.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/api/agent/sessions/missing/prompt',
    payload: {
      text: 'hello',
      context: [
        {
          kind: 'attachment',
          name: 'large.bin',
          mimeType: 'application/octet-stream',
          data: 'A'.repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4)
        }
      ]
    }
  })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().code, 'FST_ERR_VALIDATION')
})
