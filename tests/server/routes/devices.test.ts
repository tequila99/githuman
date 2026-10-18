import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { buildApp } from '../../../src/server/app.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  DEVICE_IDLE_TTL_MS,
  DEVICE_TOUCH_INTERVAL_MS,
  PAIRING_REQUEST_TTL_MS
} from '../../../src/shared/devices/constants.ts'
import type { Access, Device } from '../../../src/shared/devices/types.ts'

// The LAN address of this server in the tests; `allowedHosts` admits it.
const SERVER = '192.168.1.10'
const HOST = `${SERVER}:3847`
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

async function setup(t: TestContext) {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const project = await mkdtemp(join(tmpdir(), 'devices-notes-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const clock = { now: Date.parse('2026-10-17T10:00:00.000Z') }
  const eventBus = createEventBus()
  const events: string[] = []
  eventBus.subscribe(event => events.push(event.type))
  const announced: Device[] = []
  const app = buildApp({
    repositoryPath: fixture.dir,
    projectPath: project,
    db: createTestDatabase(),
    eventBus,
    allowedHosts: [SERVER],
    now: () => clock.now,
    onPairingRequest: device => announced.push(device)
  })
  t.after(() => app.close())

  /** A request from a LAN client with the given cookie. */
  const lan = (options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'HEAD'
    url: string
    cookie?: string
    address?: string
    host?: string
    headers?: Record<string, string>
    payload?: InjectOptions['payload']
  }): Promise<LightMyRequestResponse> =>
    app.inject({
      method: options.method ?? 'GET',
      url: options.url,
      remoteAddress: options.address ?? '192.168.1.5',
      headers: {
        host: options.host ?? HOST,
        'user-agent': PHONE,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers
      },
      ...(options.payload === undefined ? {} : { payload: options.payload })
    })

  /** Starts a pairing request; returns the cookie and the pending device. */
  const request = async (address = '192.168.1.5') => {
    const response = await lan({
      method: 'POST',
      url: '/api/devices/requests',
      address,
      payload: {}
    })
    assert.equal(response.statusCode, 200, response.body)
    const [cookie] = response.cookies
    assert.ok(cookie)
    const devices = (await app.inject('/api/devices')).json<Device[]>()
    const device = devices.find(item => item.address === address)
    assert.ok(device)
    const { code } = response.json<Access>().pairing ?? {}
    assert.ok(code)
    return { cookie: `${cookie.name}=${cookie.value}`, device, response, code }
  }

  const pair = async (address?: string) => {
    const pending = await request(address)
    const approved = await app.inject({
      method: 'POST',
      url: `/api/devices/${pending.device.id}/approve`,
      payload: { code: pending.code }
    })
    assert.equal(approved.statusCode, 200, approved.body)
    return pending
  }

  return { app, clock, events, announced, lan, request, pair }
}

test('a pairing request sets a strict HttpOnly cookie and reports pending', async t => {
  const ctx = await setup(t)
  const { response, device, code } = await ctx.request()
  const [cookie] = response.cookies
  assert.match(cookie?.name ?? '', /^ght_device_[\w-]+$/)
  assert.equal(cookie?.httpOnly, true)
  assert.equal(cookie?.sameSite, 'Strict')
  assert.equal(cookie?.path, '/')
  assert.equal(cookie?.maxAge, DEVICE_IDLE_TTL_MS / 1000)
  assert.equal(cookie?.secure, undefined)
  assert.deepEqual(response.json(), {
    status: 'pending',
    pairing: {
      code,
      expiresAt: device.expiresAt,
      remainingMs: PAIRING_REQUEST_TTL_MS
    }
  })
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(device.name, 'Safari on iPhone')
  assert.equal(device.host, HOST)
  assert.ok(!('secretHash' in device))
  assert.deepEqual(
    ctx.announced.map(item => item.id),
    [device.id]
  )
  assert.ok(ctx.events.includes('devices:changed'))
})

test('/api/access reports local, none, pending and device', async t => {
  const ctx = await setup(t)
  assert.deepEqual((await ctx.app.inject('/api/access')).json(), {
    status: 'local'
  })
  assert.deepEqual((await ctx.lan({ url: '/api/access' })).json(), {
    status: 'none'
  })
  const { cookie } = await ctx.pair()
  const access = await ctx.lan({ url: '/api/access', cookie })
  assert.deepEqual(access.json(), { status: 'device' })
  assert.equal(access.headers['cache-control'], 'no-store')
})

test('approval answers 404, 409 and 410 by the state of the request', async t => {
  const ctx = await setup(t)
  const { device, code } = await ctx.request()
  const approve = (id: string, pairingCode: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/devices/${id}/approve`,
      payload: { code: pairingCode }
    })
  const wrong = code === '000000' ? '111111' : '000000'
  assert.equal((await approve(device.id, wrong)).statusCode, 409)
  assert.equal((await approve('missing', code)).statusCode, 404)
  ctx.clock.now += PAIRING_REQUEST_TTL_MS
  assert.equal((await approve(device.id, code)).statusCode, 410)
  assert.equal((await approve(device.id, 'abc')).statusCode, 400)
})

test('the cookie still works when approval comes just before the deadline', async t => {
  const ctx = await setup(t)
  const { cookie, device, code } = await ctx.request()
  ctx.clock.now += PAIRING_REQUEST_TTL_MS - 1000
  await ctx.app.inject({
    method: 'POST',
    url: `/api/devices/${device.id}/approve`,
    payload: { code }
  })
  ctx.clock.now += 10 * 60 * 1000
  assert.deepEqual((await ctx.lan({ url: '/api/access', cookie })).json(), {
    status: 'device'
  })
})

test('an expired or revoked cookie gives none and is cleared', async t => {
  const ctx = await setup(t)
  const { cookie, device } = await ctx.pair()
  const revoked = await ctx.app.inject({
    method: 'DELETE',
    url: `/api/devices/${device.id}`
  })
  assert.equal(revoked.statusCode, 204)
  const access = await ctx.lan({ url: '/api/access', cookie })
  assert.deepEqual(access.json(), { status: 'none' })
  assert.equal(access.cookies[0]?.value, '')
  assert.equal((await ctx.lan({ url: '/api/reviews', cookie })).statusCode, 401)

  const idle = await ctx.pair('192.168.1.6')
  ctx.clock.now += DEVICE_IDLE_TTL_MS
  assert.equal(
    (await ctx.lan({ url: '/api/reviews', cookie: idle.cookie })).statusCode,
    401
  )
})

test('activity renews the cookie at most once per interval', async t => {
  const ctx = await setup(t)
  const { cookie } = await ctx.pair()
  const early = await ctx.lan({ url: '/api/reviews', cookie })
  assert.equal(early.cookies.length, 0)
  ctx.clock.now += DEVICE_TOUCH_INTERVAL_MS
  const renewed = await ctx.lan({ url: '/api/reviews', cookie })
  assert.equal(renewed.statusCode, 200)
  assert.equal(renewed.cookies[0]?.maxAge, DEVICE_IDLE_TTL_MS / 1000)
})

test('a foreign Host is rejected for every API request, pairing included', async t => {
  const ctx = await setup(t)
  const rebound = { host: 'evil.example:3847' }
  const pairing = await ctx.lan({
    method: 'POST',
    url: '/api/devices/requests',
    ...rebound,
    headers: { origin: 'http://evil.example:3847' },
    payload: {}
  })
  assert.equal(pairing.statusCode, 403)
  assert.equal(pairing.cookies.length, 0)
  const { cookie } = await ctx.pair()
  assert.equal(
    (await ctx.lan({ url: '/api/reviews', cookie, ...rebound })).statusCode,
    403
  )
  // A loopback name from a LAN client is not an allowed host either.
  assert.equal(
    (await ctx.lan({ url: '/api/reviews', cookie, host: 'localhost:3847' }))
      .statusCode,
    403
  )
})

test('a write with a foreign Origin is rejected even with a device cookie', async t => {
  const ctx = await setup(t)
  const { cookie } = await ctx.pair()
  const response = await ctx.lan({
    method: 'POST',
    url: '/api/reviews',
    cookie,
    headers: { origin: 'http://evil.example' },
    payload: { sourceType: 'staged' }
  })
  assert.equal(response.statusCode, 403)
})

test('this machine needs no pairing, and devices cannot manage devices', async t => {
  const ctx = await setup(t)
  const local = await ctx.app.inject({
    method: 'POST',
    url: '/api/devices/requests',
    payload: {}
  })
  assert.equal(local.statusCode, 400)
  const { cookie, device } = await ctx.pair()
  const other = await ctx.request('192.168.1.7')
  for (const [method, url, payload] of [
    ['GET', '/api/devices', undefined],
    ['GET', '/api/devices/lan-addresses', undefined],
    ['POST', `/api/devices/${other.device.id}/approve`, { code: other.code }],
    ['PATCH', `/api/devices/${device.id}`, { name: 'x' }],
    ['DELETE', `/api/devices/${other.device.id}`, undefined]
  ] as const) {
    const response = await ctx.lan({ method, url, cookie, payload })
    assert.equal(response.statusCode, 403, `${method} ${url}`)
  }
})

test('rename and list devices from this machine', async t => {
  const ctx = await setup(t)
  const { device } = await ctx.pair()
  const renamed = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/devices/${device.id}`,
    payload: { name: 'My phone' }
  })
  assert.equal(renamed.json<Device>().name, 'My phone')
  const listed = (await ctx.app.inject('/api/devices')).json<Device[]>()
  assert.deepEqual(
    listed.map(item => [item.name, item.state]),
    [['My phone', 'trusted']]
  )
  const addresses = await ctx.app.inject('/api/devices/lan-addresses')
  assert.equal(addresses.statusCode, 200)
  assert.ok(Array.isArray(addresses.json()))
})

test('too frequent pairing requests from one address get 429', async t => {
  const ctx = await setup(t)
  await ctx.request()
  const again = await ctx.lan({
    method: 'POST',
    url: '/api/devices/requests',
    payload: {}
  })
  assert.equal(again.statusCode, 429)
  // Polling the status does not count.
  assert.equal((await ctx.lan({ url: '/api/access' })).statusCode, 200)
})

test('route table: access by state for every kind of route', async t => {
  const ctx = await setup(t)
  const device = (await ctx.pair('192.168.1.20')).cookie
  const pending = (await ctx.request('192.168.1.21')).cookie
  type Method = 'GET' | 'POST' | 'HEAD'
  const routes: Array<{
    name: string
    method: Method
    url: string
    payload?: InjectOptions['payload']
    /** Non-API routes carry no data and pass for everyone. */
    open?: boolean
    /** Device management: this machine only. */
    localOnly?: boolean
  }> = [
    { name: 'read reviews', method: 'GET', url: '/api/reviews' },
    { name: 'head reviews', method: 'HEAD', url: '/api/reviews' },
    { name: 'git info', method: 'GET', url: '/api/git/info' },
    { name: 'diff files', method: 'GET', url: '/api/diff/staged/files' },
    {
      name: 'create review',
      method: 'POST',
      url: '/api/reviews',
      payload: { sourceType: 'staged' }
    },
    { name: 'export', method: 'GET', url: '/api/reviews/missing/export' },
    { name: 'notes', method: 'GET', url: '/api/notes' },
    {
      name: 'write note',
      method: 'POST',
      url: '/api/notes/document',
      payload: { path: 'from-lan.md', text: '# LAN' }
    },
    { name: 'note asset', method: 'GET', url: '/api/notes/assets/missing' },
    { name: 'openapi', method: 'GET', url: '/api/openapi.json' },
    { name: 'app info', method: 'GET', url: '/api/app-info' },
    { name: 'unknown api', method: 'GET', url: '/api/unknown' },
    { name: 'encoded path', method: 'GET', url: '/%61pi/reviews' },
    { name: 'devices', method: 'GET', url: '/api/devices', localOnly: true },
    { name: 'health', method: 'GET', url: '/health', open: true }
  ]
  const states: Array<{
    name: string
    send: (route: (typeof routes)[number]) => ReturnType<typeof ctx.lan>
    allowed: (route: (typeof routes)[number]) => number[] | 'pass'
  }> = [
    {
      name: 'local',
      send: route =>
        ctx.app.inject({
          method: route.method,
          url: route.url,
          ...(route.payload === undefined ? {} : { payload: route.payload })
        }),
      allowed: () => 'pass'
    },
    {
      name: 'device',
      send: route => ctx.lan({ ...route, cookie: device }),
      allowed: route => (route.localOnly ? [403] : 'pass')
    },
    {
      name: 'pending',
      send: route => ctx.lan({ ...route, cookie: pending }),
      allowed: route => (route.open ? 'pass' : [401])
    },
    {
      name: 'none',
      send: route => ctx.lan(route),
      allowed: route => (route.open ? 'pass' : [401])
    },
    {
      name: 'foreign host',
      send: route =>
        ctx.lan({ ...route, cookie: device, host: 'evil.example:3847' }),
      allowed: route => (route.open ? 'pass' : [403])
    }
  ]
  for (const state of states) {
    for (const route of routes) {
      const response = await state.send(route)
      const expected = state.allowed(route)
      const label = `${state.name}: ${route.method} ${route.url} → ${response.statusCode} ${response.body.slice(0, 120)}`
      if (expected === 'pass') {
        assert.ok(![401, 403].includes(response.statusCode), label)
      } else {
        assert.ok(expected.includes(response.statusCode), label)
      }
    }
  }
})

test('device names with control characters are rejected; an empty rename is 400', async t => {
  const ctx = await setup(t)
  for (const name of [
    'a\nb',
    'Phone\r\nPairing request from x',
    'x\u001b[2J',
    'x\u009b'
  ]) {
    const response = await ctx.lan({
      method: 'POST',
      url: '/api/devices/requests',
      address: `192.168.1.${30 + name.length}`,
      payload: { name }
    })
    assert.equal(response.statusCode, 400, JSON.stringify(name))
  }
  assert.equal(ctx.announced.length, 0)
  const { device } = await ctx.pair()
  for (const name of ['   ', 'a\tb']) {
    const renamed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/devices/${device.id}`,
      payload: { name }
    })
    assert.equal(renamed.statusCode, 400, JSON.stringify(name))
  }
})

test('the time left of a request comes from the server clock', async t => {
  const ctx = await setup(t)
  const { cookie } = await ctx.request()
  ctx.clock.now += 30 * 1000
  const access = await ctx.lan({ url: '/api/access', cookie })
  assert.equal(
    access.json().pairing.remainingMs,
    PAIRING_REQUEST_TTL_MS - 30 * 1000
  )
})

test('route table: Swagger UI, comments, note assets and the SPA fallback', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const staticRoot = await mkdtemp(join(tmpdir(), 'devices-static-'))
  t.after(() => rm(staticRoot, { recursive: true, force: true }))
  await mkdir(join(staticRoot, 'assets'))
  await writeFile(join(staticRoot, 'index.html'), '<html>app</html>')
  await writeFile(join(staticRoot, 'assets', 'app.js'), 'void 0')
  const app = buildApp({
    repositoryPath: fixture.dir,
    projectPath: fixture.dir,
    db: createTestDatabase(),
    allowedHosts: [SERVER],
    apiDocs: true,
    staticRoot
  })
  t.after(() => app.close())
  const lan = (method: 'GET' | 'POST', url: string, headers = {}) =>
    app.inject({
      method,
      url,
      remoteAddress: '192.168.1.5',
      headers: { host: HOST, ...headers },
      ...(method === 'POST' ? { payload: {} } : {})
    })
  // No device: API routes are closed, files of the page are open.
  for (const [method, url] of [
    ['GET', '/api/docs'],
    ['GET', '/api/docs/json'],
    ['POST', '/api/reviews/missing/comments'],
    ['POST', '/api/notes/assets']
  ] as const) {
    assert.equal((await lan(method, url)).statusCode, 401, url)
  }
  assert.equal((await lan('GET', '/')).statusCode, 200)
  assert.equal((await lan('GET', '/assets/app.js')).statusCode, 200)
  const fallback = await lan('GET', '/reviews/1')
  assert.equal(fallback.statusCode, 200)
  assert.equal(fallback.body, '<html>app</html>')
  // A trusted device reaches them.
  const created = await lan('POST', '/api/devices/requests')
  const [cookie] = created.cookies
  const [device] = (await app.inject('/api/devices')).json<Device[]>()
  const code = created.json<Access>().pairing?.code
  assert.ok(cookie && device && code)
  await app.inject({
    method: 'POST',
    url: `/api/devices/${device.id}/approve`,
    payload: { code }
  })
  const withCookie = { cookie: `${cookie.name}=${cookie.value}` }
  for (const [method, url] of [
    ['GET', '/api/docs/json'],
    ['POST', '/api/reviews/missing/comments'],
    ['POST', '/api/notes/assets']
  ] as const) {
    const status = (await lan(method, url, withCookie)).statusCode
    assert.ok(![401, 403].includes(status), `${url} → ${status}`)
  }
})
