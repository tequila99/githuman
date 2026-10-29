import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

test('search HTTP serializes complete snippets/anchors and applies query/body filters', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-search-http-')),
    db = createTestDatabase()
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
  const node = service.create(
    {
      requestId: 'http-search',
      body: 'Исходный текст ёж 🧪\r\n',
      metadata: { title: 'Source', tags: ['wanted'] }
    },
    { kind: 'user', id: 'local' }
  )
  await app.ready()
  const input = {
    query: 'еж',
    mode: 'exact' as const,
    filters: { statuses: ['draft' as const], tags: ['wanted'] }
  }
  const expected = service.search.search(input)
  const post = await app.inject({
    method: 'POST',
    url: '/api/artifacts/search',
    payload: input
  })
  assert.equal(post.statusCode, 200, post.body)
  assert.deepEqual(post.json(), expected)
  const get = await app.inject(
    '/api/artifacts/search?query=%D0%B5%D0%B6&mode=exact&status=draft&tag=wanted'
  )
  assert.equal(get.statusCode, 200, get.body)
  assert.deepEqual(get.json(), expected)
  assert.equal(get.json().items[0].id, node.id)
  assert.equal(get.json().items[0].anchor.quote, 'Исходный текст ёж 🧪\r\n')
  assert.equal(
    (
      await app.inject(
        '/api/artifacts/search?query=one%20two%20three%20four%20five%20six%20seven%20eight%20nine'
      )
    ).statusCode,
    400
  )
  const denied = await app.inject({
    method: 'POST',
    url: '/api/artifacts/search',
    remoteAddress: '192.168.1.2',
    headers: { host: 'localhost' },
    payload: input
  })
  assert.ok(denied.statusCode === 401 || denied.statusCode === 403)
})

test('review R3/R4: malformed cursors and NUL return HTTP 400 on a nonempty index', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-search-input-')),
    db = createTestDatabase()
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
  for (let i = 0; i < 2; i++) {
    service.create(
      {
        requestId: `input-${i}`,
        body: 'alpha abc def',
        metadata: { title: `Input ${i}`, tags: [] }
      },
      { kind: 'user', id: 'local' }
    )
  }
  await app.ready()
  const input = {
    query: 'alpha',
    limit: 1,
    filters: { statuses: ['draft' as const] }
  }
  const first = service.search.search(input)
  assert.ok(first.nextCursor)
  const original = JSON.parse(
    Buffer.from(first.nextCursor, 'base64url').toString('utf8')
  )
  for (const variants of [
    [[], ['alpha']],
    [['alpha'], ['extra']],
    [['alpha', 'a"b']],
    [['wrong']],
    [['alpha', 'alpha']],
    [['alpha', 'alphabetical']]
  ]) {
    const cursor = Buffer.from(
      JSON.stringify({ ...original, variants })
    ).toString('base64url')
    const response = await app.inject({
      method: 'POST',
      url: '/api/artifacts/search',
      payload: { ...input, cursor }
    })
    assert.equal(response.statusCode, 400, response.body)
  }
  for (const mode of ['auto', 'exact'] as const) {
    assert.throws(
      () => service.search.search({ query: 'abc\u0000def', mode }),
      /must not contain NUL/
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/artifacts/search',
      payload: { query: 'abc\u0000def', mode }
    })
    assert.equal(response.statusCode, 400, response.body)
  }
  assert.equal(
    (await app.inject('/api/artifacts/search?query=abc%00def')).statusCode,
    400
  )
})
