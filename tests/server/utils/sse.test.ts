import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import type { FastifyPluginAsync } from 'fastify'
import {
  MAX_QUEUED_MESSAGES,
  safeSend,
  STALL_TIMEOUT_MS,
  type SseSender
} from '../../../src/server/utils/sse.ts'
import { MAX_AGENT_SESSIONS } from '../../../src/shared/agents/constants.ts'
import { MAX_BUFFERED_EVENTS } from '../../../src/server/services/agent/agent-session.ts'

const MESSAGE = { event: 'agent', data: {} }

test('a connected stream gets the message', () => {
  const sent: unknown[] = []
  safeSend(
    {
      isConnected: true,
      close: () => {},
      send: message => {
        sent.push(message)
        return Promise.resolve()
      }
    },
    MESSAGE
  )
  assert.deepEqual(sent, [MESSAGE])
})

test('a closed stream is skipped', () => {
  let calls = 0
  const sse: SseSender = {
    isConnected: false,
    close: () => {},
    send: () => {
      calls++
      return Promise.resolve()
    }
  }
  safeSend(sse, MESSAGE)
  assert.equal(calls, 0)
})

test('a rejected send does not become an unhandled rejection', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    safeSend(
      {
        isConnected: true,
        close: () => {},
        send: () => Promise.reject(new Error('SSE connection is closed'))
      },
      MESSAGE
    )
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.deepEqual(unhandled, [])
})

test(
  'SSE bursts keep response listeners bounded under backpressure',
  { timeout: 10000 },
  async t => {
    const { default: Fastify } = await import('fastify')
    const { default: ssePlugin } = await import('@fastify/sse')
    const app = Fastify()
    await app.register(
      ssePlugin as unknown as FastifyPluginAsync<{ heartbeatInterval: number }>,
      {
        heartbeatInterval: 0
      }
    )
    const controller = new AbortController()
    t.after(async () => {
      controller.abort()
      await app.close()
    })
    let maxDrain = 0
    let maxError = 0
    app.get('/events', { sse: true }, async (_request, reply) => {
      reply.sse.keepAlive()
      await reply.sse.send({ event: 'connected', data: {} })
      const write = reply.raw.write.bind(reply.raw)
      reply.raw.write = ((chunk: string) => {
        write(chunk)
        setImmediate(() => reply.raw.emit('drain'))
        return false
      }) as typeof reply.raw.write
      for (let id = 0; id < 50; id++) {
        safeSend(reply.sse, { event: 'burst', data: id })
        maxDrain = Math.max(maxDrain, reply.raw.listenerCount('drain'))
        maxError = Math.max(maxError, reply.raw.listenerCount('error'))
      }
    })
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const response = await fetch(`${address}/events`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' }
    })
    const reader = response.body!.getReader()
    let text = ''
    while (!text.includes('data: 49\n')) {
      const chunk = await reader.read()
      assert.equal(chunk.done, false)
      text += Buffer.from(chunk.value).toString()
    }
    const values = [...text.matchAll(/event: burst\ndata: (\d+)/g)].map(match =>
      Number(match[1])
    )
    assert.deepEqual(
      values,
      Array.from({ length: 50 }, (_, index) => index)
    )
    assert.ok(maxDrain <= 1, `drain listeners: ${maxDrain}`)
    assert.ok(maxError <= 2, `error listeners: ${maxError}`)
  }
)

test('a blocked connection does not block another connection', async () => {
  const sent: unknown[] = []
  let release!: () => void
  const slow: SseSender = {
    isConnected: true,
    close: () => {},
    send: message => {
      sent.push(message.data)
      return new Promise<void>(resolve => {
        release = resolve
      })
    }
  }
  safeSend(slow, { event: 'agent', data: 'first' })
  safeSend(slow, { event: 'agent', data: 'second' })
  safeSend(
    {
      isConnected: true,
      close: () => {},
      send: message => {
        sent.push(message.data)
        return Promise.resolve()
      }
    },
    { event: 'agent', data: 'other' }
  )
  assert.deepEqual(sent, ['first', 'other'])
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['first', 'other', 'second'])
  release()
})

test('disconnect discards messages queued behind a blocked send', async () => {
  let connected = true
  let close!: () => void
  let release!: () => void
  const sent: unknown[] = []
  const sse: SseSender = {
    get isConnected() {
      return connected
    },
    onClose: callback => {
      close = callback
    },
    close: () => {},
    send: message => {
      sent.push(message.data)
      return new Promise<void>(resolve => {
        release = resolve
      })
    }
  }
  safeSend(sse, { event: 'agent', data: 'first' })
  safeSend(sse, { event: 'agent', data: 'second' })
  connected = false
  close()
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['first'])
})

test('a synchronous send failure is contained', () => {
  assert.doesNotThrow(() =>
    safeSend(
      {
        isConnected: true,
        close: () => {},
        send: () => {
          throw new Error('closed')
        }
      },
      MESSAGE
    )
  )
})

/** A connection whose first send never finishes until `release` runs. */
function blockedSender() {
  const sent: unknown[] = []
  let closes = 0
  let connected = true
  const sse: SseSender = {
    get isConnected() {
      return connected
    },
    send: message => {
      sent.push(message.data)
      return new Promise<void>(() => {})
    },
    close: () => {
      closes++
      connected = false
    }
  }
  return { sse, sent, closes: () => closes }
}

test('a full queue closes the connection and drops later messages (#85)', () => {
  const { sse, sent, closes } = blockedSender()
  for (let index = 0; index <= MAX_QUEUED_MESSAGES; index++) {
    safeSend(sse, { event: 'agent', data: index })
  }
  assert.equal(closes(), 0, 'the first send plus a full queue is still allowed')
  safeSend(sse, { event: 'agent', data: 'over' })
  assert.equal(closes(), 1)
  safeSend(sse, { event: 'agent', data: 'after' })
  assert.equal(closes(), 1)
  assert.deepEqual(sent, [0])
})

test('a send that waits too long closes the connection on the next message (#85)', t => {
  mock.timers.enable({ apis: ['Date'], now: 0 })
  t.after(() => mock.timers.reset())
  const { sse, closes } = blockedSender()
  safeSend(sse, { event: 'agent', data: 1 })
  safeSend(sse, { event: 'agent', data: 2 })
  mock.timers.tick(STALL_TIMEOUT_MS)
  safeSend(sse, { event: 'agent', data: 3 })
  assert.equal(closes(), 0, 'exactly at the limit is not a stall')
  mock.timers.tick(1)
  safeSend(sse, { event: 'agent', data: 4 })
  assert.equal(closes(), 1)
})

test('a slow client that still reads keeps its connection (#85)', async t => {
  mock.timers.enable({ apis: ['Date'], now: 0 })
  t.after(() => mock.timers.reset())
  const sent: unknown[] = []
  const finish: (() => void)[] = []
  let closes = 0
  const sse: SseSender = {
    isConnected: true,
    send: message => {
      sent.push(message.data)
      return new Promise<void>(resolve => finish.push(resolve))
    },
    close: () => {
      closes++
    }
  }
  safeSend(sse, { event: 'agent', data: 0 })
  // Each send takes two thirds of the limit, and every message arrives while
  // a send waits. The total is far above the limit, but no single send is.
  for (let index = 1; index < 5; index++) {
    mock.timers.tick((STALL_TIMEOUT_MS * 2) / 3)
    safeSend(sse, { event: 'agent', data: index })
    finish.shift()?.()
    await new Promise(resolve => setImmediate(resolve))
  }
  finish.shift()?.()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closes, 0)
  assert.deepEqual(sent, [0, 1, 2, 3, 4])
})

test('the queue limit is above the largest agent replay (#85)', () => {
  // A `gap` and a `state` for each session come with the replayed events.
  const replay = MAX_AGENT_SESSIONS * (MAX_BUFFERED_EVENTS + 2)
  assert.ok(MAX_QUEUED_MESSAGES > replay)
})

test('one full queue does not close another connection (#85)', () => {
  const full = blockedSender()
  const other = blockedSender()
  for (let index = 0; index <= MAX_QUEUED_MESSAGES + 1; index++) {
    safeSend(full.sse, { event: 'agent', data: index })
  }
  safeSend(other.sse, { event: 'agent', data: 'other' })
  assert.equal(full.closes(), 1)
  assert.equal(other.closes(), 0)
  assert.deepEqual(other.sent, ['other'])
})

test('a close that throws is contained (#85)', () => {
  const sse: SseSender = {
    isConnected: true,
    send: () => new Promise<void>(() => {}),
    close: () => {
      throw new Error('already closed')
    }
  }
  assert.doesNotThrow(() => {
    for (let index = 0; index <= MAX_QUEUED_MESSAGES + 2; index++) {
      safeSend(sse, { event: 'agent', data: index })
    }
  })
})

test(
  'a real stream with a full queue ends cleanly and runs its close callbacks (#85)',
  { timeout: 10000 },
  async t => {
    const { default: Fastify } = await import('fastify')
    const { default: ssePlugin } = await import('@fastify/sse')
    const app = Fastify()
    await app.register(
      ssePlugin as unknown as FastifyPluginAsync<{ heartbeatInterval: number }>,
      { heartbeatInterval: 0 }
    )
    t.after(() => app.close())
    let closedByServer = false
    app.get('/events', { sse: true }, async (_request, reply) => {
      reply.sse.keepAlive()
      await reply.sse.send({ event: 'connected', data: {} })
      reply.sse.onClose(() => {
        closedByServer = true
      })
      // All at once, as a replay does: the queue fills before any send ends.
      for (let id = 0; id <= MAX_QUEUED_MESSAGES + 1; id++) {
        safeSend(reply.sse, { event: 'burst', data: id })
      }
    })
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const response = await fetch(`${address}/events`, {
      headers: { accept: 'text/event-stream' }
    })
    const reader = response.body!.getReader()
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
    }
    assert.equal(closedByServer, true)
  }
)
