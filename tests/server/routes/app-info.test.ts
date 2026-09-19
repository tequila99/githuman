import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../../../src/server/app.ts'
import { getAppVersion } from '../../../src/server/app-version.ts'

test('GET /api/app-info returns the current app version', async t => {
  const app = buildApp()
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/app-info' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { version: getAppVersion() })
})
