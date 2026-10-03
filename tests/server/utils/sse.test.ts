import assert from 'node:assert/strict'
import { test } from 'node:test'
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
