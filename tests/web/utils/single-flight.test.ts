import { test } from 'node:test'
import assert from 'node:assert/strict'
import { singleFlight } from '@/utils/single-flight'

// A `run` whose calls stay pending until the test settles them, in order.
function controlledRun() {
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = []
  const run = () =>
    new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  return { run, pending }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('a single call runs once', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const done = call()
  assert.equal(pending.length, 1)
  pending[0]!.resolve()
  await done
  assert.equal(pending.length, 1)
})

test('a call made mid-run waits for a second run that starts after the first', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const first = call()
  let secondDone = false
  const second = call().then(() => (secondDone = true))
  assert.equal(pending.length, 1, 'no parallel run')

  pending[0]!.resolve()
  await first
  await tick()
  assert.equal(pending.length, 2, 'follow-up started after the first settled')
  assert.equal(secondDone, false, 'still waiting for the follow-up')

  pending[1]!.resolve()
  await second
  assert.equal(secondDone, true)
})

test('many calls mid-run share one follow-up', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const first = call()
  const followers = [call(), call(), call()]
  pending[0]!.resolve()
  await first
  await tick()
  assert.equal(pending.length, 2)

  pending[1]!.resolve()
  await Promise.all(followers)
  assert.equal(pending.length, 2)
})

test('a call made during the follow-up queues another run instead of joining it', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const first = call()
  const second = call()
  pending[0]!.resolve()
  await first
  await tick()

  const third = call() // while the follow-up (run 2) is in flight
  pending[1]!.resolve()
  await second
  await tick()
  assert.equal(pending.length, 3)
  pending[2]!.resolve()
  await third
})

test('the follow-up still runs when the first run rejects', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const first = call()
  const second = call()
  pending[0]!.reject(new Error('boom'))
  await assert.rejects(first, /boom/)
  await tick()
  assert.equal(pending.length, 2)

  pending[1]!.resolve()
  await second
})

test('after everything settles, the next call starts a fresh run immediately', async () => {
  const { run, pending } = controlledRun()
  const call = singleFlight(run)

  const first = call()
  pending[0]!.resolve()
  await first

  void call()
  assert.equal(pending.length, 2)
  pending[1]!.resolve()
})
