import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEventBus } from '../../src/server/event-bus.ts'

test('publish delivers the event to every current subscriber', () => {
  const bus = createEventBus()
  const receivedA: unknown[] = []
  const receivedB: unknown[] = []
  bus.subscribe(event => receivedA.push(event))
  bus.subscribe(event => receivedB.push(event))

  bus.publish({ type: 'review:created', reviewId: 'r1' })

  assert.deepEqual(receivedA, [{ type: 'review:created', reviewId: 'r1' }])
  assert.deepEqual(receivedB, [{ type: 'review:created', reviewId: 'r1' }])
})

test('unsubscribe stops delivering events to that listener', () => {
  const bus = createEventBus()
  const received: unknown[] = []
  const unsubscribe = bus.subscribe(event => received.push(event))

  unsubscribe()
  bus.publish({ type: 'review:updated', reviewId: 'r1' })

  assert.deepEqual(received, [])
})
