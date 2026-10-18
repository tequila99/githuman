import assert from 'node:assert/strict'
import { test } from 'node:test'
import Fastify from 'fastify'
import { isLocalRequest } from '../../../../src/server/hooks/access/local-request.ts'

async function localApp() {
  const app = Fastify()
  app.get('/probe', async request => ({ local: isLocalRequest(request) }))
  await app.ready()
  return app
}

async function probe(
  app: Awaited<ReturnType<typeof localApp>>,
  remoteAddress: string,
  headers: Record<string, string>
): Promise<boolean> {
  const response = await app.inject({ url: '/probe', remoteAddress, headers })
  return response.json().local
}

test('a loopback socket with a loopback Host is local', async t => {
  const app = await localApp()
  t.after(() => app.close())
  for (const [remote, host] of [
    ['127.0.0.1', 'localhost:3847'],
    ['::1', '[::1]:3847'],
    ['::ffff:127.0.0.1', '127.0.0.1:3847']
  ]) {
    assert.equal(await probe(app, remote, { host }), true, `${remote} ${host}`)
  }
  assert.equal(
    await probe(app, '127.0.0.1', {
      host: 'localhost:3847',
      origin: 'http://localhost:3847'
    }),
    true
  )
})

test('a LAN client is never local, whatever Host it sends', async t => {
  const app = await localApp()
  t.after(() => app.close())
  for (const remote of ['192.168.1.5', '::ffff:192.168.1.5', 'fe80::1']) {
    assert.equal(
      await probe(app, remote, {
        host: 'localhost:3847',
        origin: 'http://localhost:3847'
      }),
      false,
      remote
    )
  }
})

test('a foreign Host, Origin or userinfo is not local', async t => {
  const app = await localApp()
  t.after(() => app.close())
  for (const headers of [
    { host: 'evil.example:3847' },
    { host: 'evil.example:3847', origin: 'http://evil.example:3847' },
    { host: 'localhost:3847', origin: 'http://evil.example' },
    { host: 'localhost:3847', origin: 'null' },
    { host: 'localhost:80@evil.example' },
    { host: '192.168.1.10:3847' }
  ] as Record<string, string>[]) {
    assert.equal(
      await probe(app, '127.0.0.1', headers),
      false,
      JSON.stringify(headers)
    )
  }
})

test('a proxy on this machine forwards a remote client as not local', async t => {
  const app = await localApp()
  t.after(() => app.close())
  const host = { host: 'localhost:9000' }
  assert.equal(
    await probe(app, '127.0.0.1', {
      ...host,
      'x-forwarded-for': '192.168.1.5'
    }),
    false
  )
  assert.equal(
    await probe(app, '127.0.0.1', {
      ...host,
      'x-forwarded-for': '127.0.0.1, 192.168.1.5'
    }),
    false
  )
  assert.equal(
    await probe(app, '127.0.0.1', { ...host, 'x-forwarded-for': 'garbage' }),
    false
  )
  assert.equal(
    await probe(app, '127.0.0.1', {
      ...host,
      'x-forwarded-for': '::ffff:127.0.0.1'
    }),
    true
  )
})
