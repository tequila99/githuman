import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { buildApp } from '../../../src/server/app.ts'
import { createFileDatabase } from '../../../src/server/db/index.ts'
import { DEVICE_IDLE_TTL_MS } from '../../../src/shared/devices/constants.ts'
import { machineAddresses } from '../../../src/server/utils/lan-addresses.ts'
import type { Access, Device } from '../../../src/shared/devices/types.ts'
import type { AgentPreset } from '../../../src/shared/agents/types.ts'

// The LAN address of this server in inject tests; `allowedHosts` admits it.
const SERVER = '192.168.1.10'
const HOST = `${SERVER}:3847`
const ORIGIN = `http://${HOST}`
const FAKE_AGENT = join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')
const PRESET: AgentPreset = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [FAKE_AGENT],
  autoApprovesEdits: false
}

async function pairCookie(
  app: ReturnType<typeof buildApp>,
  host: string,
  address = '192.168.1.5'
): Promise<{ cookie: string; id: string }> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/devices/requests',
    remoteAddress: address,
    headers: { host },
    payload: {}
  })
  const [cookie] = created.cookies
  assert.ok(cookie, created.body)
  const [device] = (await app.inject('/api/devices')).json<Device[]>()
  const code = created.json<Access>().pairing?.code
  assert.ok(device && code)
  const approved = await app.inject({
    method: 'POST',
    url: `/api/devices/${device.id}/approve`,
    payload: { code }
  })
  assert.equal(approved.statusCode, 200, approved.body)
  return { cookie: `${cookie.name}=${cookie.value}`, id: device.id }
}

function setup(t: TestContext) {
  const app = buildApp({
    allowedHosts: [SERVER],
    agentPresets: [PRESET],
    terminalEnabled: true
  })
  t.after(() => app.close())
  return app
}

test('a trusted device reaches agents and the terminal token; others do not', async t => {
  const app = setup(t)
  const { cookie } = await pairCookie(app, HOST)
  const lan = (
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: '192.168.1.5',
      headers: { host: HOST, ...headers }
    })

  assert.equal(
    (await lan('GET', '/api/agent/presets', { cookie })).statusCode,
    200
  )
  const token = await lan('POST', '/api/terminal/token', {
    cookie,
    origin: ORIGIN
  })
  assert.equal(token.statusCode, 200, token.body)
  assert.equal(token.json().token.length, 43)

  // The terminal token needs Origin; a foreign Origin is refused everywhere.
  assert.equal(
    (await lan('POST', '/api/terminal/token', { cookie })).statusCode,
    403
  )
  assert.equal(
    (
      await lan('GET', '/api/agent/presets', {
        cookie,
        origin: 'http://evil.example'
      })
    ).statusCode,
    403
  )
  // Without a device the access hook answers first.
  assert.equal((await lan('GET', '/api/agent/presets', {})).statusCode, 401)
  assert.equal(
    (await lan('POST', '/api/terminal/token', { origin: ORIGIN })).statusCode,
    401
  )
})

/** Opens the server on every interface and returns a LAN address of this machine. */
async function listenOnLan(
  t: TestContext,
  app: ReturnType<typeof buildApp>
): Promise<{ host: string } | undefined> {
  const address = machineAddresses().find(item => !item.includes(':'))
  if (!address) {
    t.skip('no non-loopback IPv4 interface available in this environment')
    return undefined
  }
  await app.listen({ host: '0.0.0.0', port: 0 })
  const bound = app.server.address()
  assert.ok(bound && typeof bound !== 'string')
  return { host: `${address}:${bound.port}` }
}

test('revoke closes an open terminal socket of the device', async t => {
  const app = setup(t)
  const lan = await listenOnLan(t, app)
  if (!lan) return
  const origin = `http://${lan.host}`
  const { cookie, id } = await pairCookie(app, lan.host)
  const token = (
    await app.inject({
      method: 'POST',
      url: '/api/terminal/token',
      remoteAddress: '192.168.1.5',
      headers: { host: lan.host, origin, cookie }
    })
  ).json().token as string
  const socket = new WebSocket(
    `ws://${lan.host}/api/terminal/ws?token=${token}`,
    { headers: { Origin: origin, Cookie: cookie } }
  )
  await once(socket, 'open')
  const closed = once(socket, 'close')
  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/devices/${id}`
  })
  assert.equal(revoked.statusCode, 204)
  await closed
})

test('revoke ends the event stream of the device', async t => {
  const app = setup(t)
  const lan = await listenOnLan(t, app)
  if (!lan) return
  const { cookie, id } = await pairCookie(app, lan.host)
  const [hostname, port] = [
    lan.host.slice(0, lan.host.lastIndexOf(':')),
    Number(lan.host.slice(lan.host.lastIndexOf(':') + 1))
  ]
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    httpRequest(
      {
        host: hostname,
        port,
        path: '/api/events',
        headers: { cookie, accept: 'text/event-stream' }
      },
      resolve
    )
      .on('error', reject)
      .end()
  })
  assert.equal(response.statusCode, 200)
  // Wait for the hello event: the stream is registered after it.
  await new Promise<void>(resolve => {
    response.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('event: connected')) resolve()
    })
  })
  const ended = once(response, 'end')
  await app.inject({ method: 'DELETE', url: `/api/devices/${id}` })
  await ended
})

/** Opens `/api/events` from the LAN address and waits for the hello event. */
async function openEvents(lanHost: string, cookie: string) {
  const split = lanHost.lastIndexOf(':')
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    httpRequest(
      {
        host: lanHost.slice(0, split),
        port: Number(lanHost.slice(split + 1)),
        path: '/api/events',
        headers: { cookie, accept: 'text/event-stream' }
      },
      resolve
    )
      .on('error', reject)
      .end()
  })
  assert.equal(response.statusCode, 200)
  await new Promise<void>(resolve => {
    response.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('event: connected')) resolve()
    })
  })
  return response
}

test('a revoke by another server on the same database ends the stream', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'devices-shared-db-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'reviews.db')
  const first = buildApp({
    db: createFileDatabase(path),
    allowedHosts: [SERVER]
  })
  const second = buildApp({
    db: createFileDatabase(path),
    allowedHosts: [SERVER]
  })
  t.after(() => first.close())
  t.after(() => second.close())
  const lan = await listenOnLan(t, first)
  if (!lan) return
  const { cookie, id } = await pairCookie(first, lan.host)
  const response = await openEvents(lan.host, cookie)
  const ended = once(response, 'end')
  const revoked = await second.inject({
    method: 'DELETE',
    url: `/api/devices/${id}`
  })
  assert.equal(revoked.statusCode, 204)
  // The first server finds the change at its next recheck.
  await ended
})

test('an expired device loses its open stream', async t => {
  const clock = { now: Date.now() }
  const app = buildApp({ allowedHosts: [SERVER], now: () => clock.now })
  t.after(() => app.close())
  const lan = await listenOnLan(t, app)
  if (!lan) return
  const { cookie } = await pairCookie(app, lan.host)
  const response = await openEvents(lan.host, cookie)
  const ended = once(response, 'end')
  clock.now += DEVICE_IDLE_TTL_MS
  await ended
})
