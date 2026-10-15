import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { FastifyReply } from 'fastify'
import { withRequestSignal } from '../../../src/server/utils/request-abort.ts'

function fakeReply(state: { destroyed?: boolean; writableFinished?: boolean }) {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
    ...state
  })
  return { raw, reply: { raw } as unknown as FastifyReply }
}

test('closing the connection before the end aborts the signal', async () => {
  const { raw, reply } = fakeReply({})
  let aborted = false
  await withRequestSignal(reply, async signal => {
    raw.emit('close')
    aborted = signal.aborted
  })
  assert.equal(aborted, true)
})

test('closing after a finished response does not abort the signal', async () => {
  const { raw, reply } = fakeReply({ writableFinished: true })
  let aborted = true
  await withRequestSignal(reply, async signal => {
    raw.emit('close')
    aborted = signal.aborted
  })
  assert.equal(aborted, false)
})

test('an already destroyed response starts with an aborted signal', async () => {
  const { reply } = fakeReply({ destroyed: true })
  const aborted = await withRequestSignal(reply, async signal => signal.aborted)
  assert.equal(aborted, true)
})

test('the close listener is removed after success and after failure', async () => {
  const { raw, reply } = fakeReply({})
  await withRequestSignal(reply, async () => undefined)
  assert.equal(raw.listenerCount('close'), 0)
  await assert.rejects(
    withRequestSignal(reply, async () => {
      assert.equal(raw.listenerCount('close'), 1)
      throw new Error('failed')
    }),
    /failed/
  )
  assert.equal(raw.listenerCount('close'), 0)
})
