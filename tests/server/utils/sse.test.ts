import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyPluginAsync } from 'fastify'
import { safeSend, type SseSender } from '../../../src/server/utils/sse.ts'

const MESSAGE = { event: 'agent', data: {} }

test('a connected stream gets the message', () => {
  const sent: unknown[] = []
  safeSend(
    {
      isConnected: true,
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
        send: () => {
          throw new Error('closed')
        }
      },
      MESSAGE
    )
  )
})
