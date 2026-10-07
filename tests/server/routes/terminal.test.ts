import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { buildApp } from '../../../src/server/app.ts'
import { TerminalTokens } from '../../../src/server/services/terminal/tokens.ts'

async function websocketStatus(url: string, origin?: string): Promise<number> {
  return await new Promise(resolve => {
    const socket = new WebSocket(url, {
      headers: origin ? { Origin: origin } : {}
    })
    socket.on('error', () => {})
    socket.on('open', () => {
      socket.close()
      resolve(101)
    })
    socket.on('unexpected-response', (_request, response) => {
      response.resume()
      socket.terminate()
      resolve(response.statusCode ?? 0)
    })
  })
}

test('terminal routes do not exist when disabled and app-info reports it', async t => {
  const app = buildApp()
  t.after(() => app.close())
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/terminal/token' }))
      .statusCode,
    404
  )
  assert.deepEqual((await app.inject('/api/app-info')).json().terminal, {
    available: false,
    mode: null
  })
})

test('token HTTP endpoint requires exact loopback origin', async t => {
  const app = buildApp({ terminalEnabled: true })
  t.after(() => app.close())
  for (const headers of [
    {},
    { host: 'localhost:3847', origin: 'null' },
    { host: 'localhost:3847', origin: 'http://evil.example' },
    { host: 'localhost:3847', origin: 'http://localhost:3848' },
    { host: 'localhost:3847', origin: 'https://localhost:3847' },
    { host: 'evil.example', origin: 'http://evil.example' }
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/terminal/token',
          headers
        })
      ).statusCode,
      403
    )
  }
  const good = await app.inject({
    method: 'POST',
    url: '/api/terminal/token',
    headers: { host: '[::1]:3847', origin: 'http://[::1]:3847' }
  })
  assert.equal(good.statusCode, 200)
  assert.equal(good.json().token.length, 43)
})

test('real upgrade hook rejects absent or wrong origin and consumes token once', async t => {
  const app = buildApp({ terminalEnabled: true })
  t.after(() => app.close())
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const issue = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/terminal/token',
        headers: { host: `127.0.0.1:${address.port}`, origin }
      })
    ).json().token as string
  const url = `${origin.replace('http:', 'ws:')}/api/terminal/ws`
  assert.equal(await websocketStatus(`${url}?token=${await issue()}`), 403)
  assert.equal(
    await websocketStatus(
      `${url}?token=${await issue()}`,
      'http://evil.example'
    ),
    403
  )
  assert.equal(await websocketStatus(`${url}?token=unknown`, origin), 403)
  const token = await issue()
  assert.equal(await websocketStatus(`${url}?token=${token}`, origin), 101)
  assert.equal(await websocketStatus(`${url}?token=${token}`, origin), 403)
})

test('invalid protocol closes a real connection', async t => {
  const app = buildApp({ terminalEnabled: true })
  t.after(() => app.close())
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const host = `127.0.0.1:${address.port}`
  const origin = `http://${host}`
  const token = (
    await app.inject({
      method: 'POST',
      url: '/api/terminal/token',
      headers: { host, origin }
    })
  ).json().token
  const socket = new WebSocket(`ws://${host}/api/terminal/ws?token=${token}`, {
    headers: { Origin: origin }
  })
  await once(socket, 'open')
  socket.send(
    JSON.stringify({ type: 'create', cols: -1, rows: 0, command: 'evil' })
  )
  await once(socket, 'close')
})

test('tokens expire, bind to origin and are one-use', () => {
  let now = 0
  const tokens = new TerminalTokens(() => now)
  const first = tokens.issue('http://localhost')
  assert.equal(tokens.consume(first, 'http://other'), false)
  assert.equal(tokens.consume(first, 'http://localhost'), false)
  const expired = tokens.issue('http://localhost')
  now = 30_000
  assert.equal(tokens.consume(expired, 'http://localhost'), false)
  const good = tokens.issue('http://localhost')
  assert.equal(tokens.consume(good, 'http://localhost'), true)
  assert.equal(tokens.consume(good, 'http://localhost'), false)
})
