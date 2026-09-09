import { test } from 'node:test'
import assert from 'node:assert/strict'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import {
  startServer,
  resolveReviewsDbPath
} from '../../src/cli/server-runtime.ts'
import { DEFAULT_DB_PREFIX } from '../../src/cli/config.ts'

test('resolveReviewsDbPath prefixes the filename with DEFAULT_DB_PREFIX by default', () => {
  assert.equal(
    resolveReviewsDbPath('/repo'),
    join('/repo', '.githuman', `${DEFAULT_DB_PREFIX}reviews.db`)
  )
})

test('resolveReviewsDbPath uses a custom prefix when given one', () => {
  assert.equal(
    resolveReviewsDbPath('/repo', 'custom-'),
    join('/repo', '.githuman', 'custom-reviews.db')
  )
})

test('resolveReviewsDbPath with an explicit empty prefix matches the original mcollina/githuman filename', () => {
  assert.equal(
    resolveReviewsDbPath('/repo', ''),
    join('/repo', '.githuman', 'reviews.db')
  )
})

function findLanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address
      }
    }
  }
  return undefined
}

test('startServer listens and serves /health on the given port', async t => {
  const { app, url } = await startServer({
    port: 0,
    host: '127.0.0.1',
    open: false
  })
  t.after(async () => {
    await app.close()
  })

  const response = await fetch(new URL('/health', url))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, { status: 'ok' })
})

test("startServer bound to 0.0.0.0 answers /health on the machine's LAN address", async t => {
  const lanAddress = findLanAddress()
  if (!lanAddress) {
    t.skip('no non-loopback IPv4 interface available in this environment')
    return
  }

  const { app, url } = await startServer({
    port: 0,
    host: '0.0.0.0',
    open: false
  })
  t.after(async () => {
    await app.close()
  })

  const port = new URL(url).port
  const response = await fetch(`http://${lanAddress}:${port}/health`)

  assert.equal(response.status, 200)
})

test('startServer rejects when the requested port is already taken', async t => {
  const first = await startServer({ port: 0, host: '127.0.0.1', open: false })
  t.after(async () => {
    await first.app.close()
  })

  const takenPort = Number(new URL(first.url).port)

  await assert.rejects(() =>
    startServer({ port: takenPort, host: '127.0.0.1', open: false })
  )
})

test('startServer resolves the git repository root and persists reviews across restarts', async t => {
  const { createTempGitRepo } = await import('../server/helpers/git-fixture.ts')
  const { writeFileSync } = await import('node:fs')

  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  await fixture.git.add('a.txt')

  const originalCwd = process.cwd()
  process.chdir(fixture.dir)

  let firstId: string
  try {
    const first = await startServer({ port: 0, host: '127.0.0.1', open: false })
    const created = await fetch(new URL('/api/reviews', first.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceType: 'staged' })
    })
    firstId = (await created.json()).id
    await first.app.close()
  } finally {
    process.chdir(originalCwd)
  }

  process.chdir(fixture.dir)
  try {
    const second = await startServer({
      port: 0,
      host: '127.0.0.1',
      open: false
    })
    t.after(async () => {
      await second.app.close()
    })

    const found = await fetch(new URL(`/api/reviews/${firstId}`, second.url))
    assert.equal(found.status, 200)
  } finally {
    process.chdir(originalCwd)
  }
})
