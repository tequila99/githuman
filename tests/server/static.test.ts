import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../src/server/app.ts'

function createFixtureStaticRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'githuman-static-'))
  writeFileSync(
    join(dir, 'index.html'),
    '<html><body>fixture-spa</body></html>'
  )
  return dir
}

test('GET / serves the built SPA index.html', async t => {
  const staticRoot = createFixtureStaticRoot()
  const app = buildApp({ staticRoot })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/' })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /fixture-spa/)
})

test('GET on an unknown non-api path falls back to index.html (client-side routing)', async t => {
  const staticRoot = createFixtureStaticRoot()
  const app = buildApp({ staticRoot })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/reviews/some-id' })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /fixture-spa/)
})

test('GET /api/unknown does not fall back to index.html', async t => {
  const staticRoot = createFixtureStaticRoot()
  const app = buildApp({ staticRoot })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/unknown' })

  assert.equal(response.statusCode, 404)
})
