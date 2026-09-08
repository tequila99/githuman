import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../../../src/server/app.ts'

test('GET /health returns 200 and status ok', async t => {
  const app = buildApp()
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/health' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { status: 'ok' })
})
