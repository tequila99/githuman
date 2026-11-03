import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-artifact-routes-'))
  const db = createTestDatabase()
  const service = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const app = buildApp({ db, repositoryPath: root, artifacts: service })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const artifact = service.create(
    {
      requestId: 'create',
      body: '# Review\nOriginal body',
      metadata: { title: 'Review', tags: ['api'] }
    },
    { kind: 'agent', id: 'test' }
  )
  await app.ready()
  return { root, app, service, artifact }
}

test('artifact routes serialize complete service responses and expose no writes', async t => {
  const { app, service, artifact } = await setup(t)
  for (const [path, expected] of [
    ['/api/artifacts', service.list()],
    [`/api/artifacts/${artifact.id}`, service.get(artifact.id)],
    [`/api/artifacts/${artifact.id}/content`, service.readContent(artifact.id)],
    [`/api/artifacts/${artifact.id}/history`, service.history(artifact.id)]
  ] as const) {
    const response = await app.inject(path)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), expected)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    const response = await app.inject({
      method,
      url: `/api/artifacts/${artifact.id}`,
      payload: { body: 'replace' }
    })
    assert.equal(response.statusCode, 404)
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/artifacts', payload: {} }))
      .statusCode,
    404
  )
})

test('artifact routes validate identifiers, ranges and preserve integrity error codes', async t => {
  const { root, app, artifact } = await setup(t)
  assert.equal((await app.inject('/api/artifacts/not-a-uuid')).statusCode, 400)
  assert.equal((await app.inject('/api/artifacts?limit=101')).statusCode, 400)
  assert.equal(
    (await app.inject(`/api/artifacts/${artifact.id}/content?offset=-1`))
      .statusCode,
    400
  )
  assert.equal(
    (await app.inject('/api/artifacts/00000000-0000-4000-8000-000000000000'))
      .statusCode,
    404
  )
  writeFileSync(
    join(root, '.githuman/artifacts', `ght-${artifact.id}.md`),
    'changed'
  )
  const response = await app.inject(`/api/artifacts/${artifact.id}/content`)
  assert.equal(response.statusCode, 422)
  assert.equal(response.json().code, 'GHT_ARTIFACT_INTEGRITY')
})

test('artifact reads require the existing local or paired-device access', async t => {
  const { app, artifact } = await setup(t)
  for (const path of [
    '/api/artifacts',
    `/api/artifacts/${artifact.id}`,
    `/api/artifacts/${artifact.id}/content`,
    `/api/artifacts/${artifact.id}/history`
  ]) {
    const response = await app.inject({
      url: path,
      remoteAddress: '192.0.2.10',
      headers: { host: 'evil.example' }
    })
    assert.equal(response.statusCode, 403)
  }
})

test('app starts artifact maintenance on ready and stops it on close', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const root = mkdtempSync(join(tmpdir(), 'ght-artifact-lifecycle-'))
  const db = createTestDatabase()
  const service = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const recover = t.mock.method(service, 'recover')
  const poll = t.mock.method(service, 'pollChanges')
  const app = buildApp({ db, repositoryPath: root, artifacts: service })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  t.mock.timers.tick(2000)
  assert.equal(recover.mock.callCount(), 0)
  assert.equal(poll.mock.callCount(), 0)
  await app.ready()
  assert.equal(recover.mock.callCount(), 1)
  assert.equal(poll.mock.callCount(), 1)
  t.mock.timers.tick(2000)
  assert.equal(recover.mock.callCount(), 2)
  assert.equal(poll.mock.callCount(), 2)
  await app.close()
  t.mock.timers.tick(4000)
  assert.equal(recover.mock.callCount(), 2)
  assert.equal(poll.mock.callCount(), 2)
})
