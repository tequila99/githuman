import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { yieldToEventLoop } from '@/utils/yield-to-event-loop'

describe('yieldToEventLoop', () => {
  it('continues after a message task', async () => {
    let timer = false
    setTimeout(() => (timer = true), 50)
    await yieldToEventLoop()
    // A message task does not wait for the 50 ms timer.
    assert.equal(timer, false)
  })

  it('falls back to a timer without MessageChannel', async () => {
    const original = globalThis.MessageChannel
    // @ts-expect-error the test removes the global
    delete globalThis.MessageChannel
    try {
      await yieldToEventLoop()
    } finally {
      globalThis.MessageChannel = original
    }
  })
})
