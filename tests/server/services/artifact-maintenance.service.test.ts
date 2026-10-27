import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactMaintenanceService } from '../../../src/server/services/artifact-maintenance.service.ts'

// Simulate a persistent storage failure.
function fail(): never {
  throw new Error('disk')
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const calls: string[] = []
  const errors: { error: unknown; phase: string }[] = []
  const storage = {
    recover: t.mock.fn((cleanupCommitted = true) => {
      calls.push(cleanupCommitted ? 'initial' : 'recovery')
      return { recovered: [], awaitingRetry: [], failed: [], busy: [] }
    }),
    pollChanges: t.mock.fn(() => {
      calls.push('poll')
    })
  }
  const service = new ArtifactMaintenanceService({
    storage,
    onError: (error, phase) => errors.push({ error, phase })
  })
  t.after(() => service.stop())
  return { service, storage, calls, errors }
}

test('maintenance starts explicitly, has one timer and stops and restarts safely', t => {
  const { service, calls } = setup(t)
  t.mock.timers.tick(4000)
  assert.deepEqual(calls, [])
  service.stop()
  service.start()
  service.start()
  assert.deepEqual(calls, ['initial', 'poll'])
  t.mock.timers.tick(2000)
  assert.deepEqual(calls, ['initial', 'poll', 'recovery', 'poll'])
  service.stop()
  service.stop()
  t.mock.timers.tick(4000)
  assert.equal(calls.length, 4)
  service.start()
  t.mock.timers.tick(2000)
  assert.deepEqual(calls.slice(4), ['initial', 'poll', 'recovery', 'poll'])
})

for (const [phase, reported] of [
  ['recover', 'recovery'],
  ['pollChanges', 'poll']
] as const) {
  test(`initial ${phase} failure is reported and the timer still starts`, t => {
    const { service, storage, calls, errors } = setup(t)
    const failure = new Error('startup failed')
    storage[phase].mock.mockImplementationOnce(() => {
      throw failure
    })
    service.start()
    assert.deepEqual(errors, [{ error: failure, phase: reported }])
    // Polling must run even when the initial recovery fails.
    assert.equal(storage.pollChanges.mock.callCount(), 1)
    const count = calls.length
    t.mock.timers.tick(2000)
    assert.deepEqual(calls.slice(count), ['recovery', 'poll'])
  })
}

test('stop from the error handler leaves no timer', t => {
  const { storage, calls } = setup(t)
  const service: ArtifactMaintenanceService = new ArtifactMaintenanceService({
    storage,
    onError: () => service.stop()
  })
  storage.recover.mock.mockImplementationOnce(() => {
    throw new Error('startup failed')
  })
  service.start()
  const count = calls.length
  t.mock.timers.tick(4000)
  assert.equal(calls.length, count)
})

test('background recovery failure still polls and retries on the next interval', t => {
  const { service, storage, calls, errors } = setup(t)
  service.start()
  const failure = new Error('recovery failed')
  storage.recover.mock.mockImplementationOnce(() => {
    throw failure
  })
  t.mock.timers.tick(2000)
  assert.deepEqual(errors, [{ error: failure, phase: 'recovery' }])
  assert.deepEqual(calls, ['initial', 'poll', 'poll'])
  t.mock.timers.tick(2000)
  assert.deepEqual(calls.slice(-2), ['recovery', 'poll'])
})

test('background polling failure is reported and does not stop recovery or future polling', t => {
  const { service, storage, calls, errors } = setup(t)
  service.start()
  const failure = new Error('poll failed')
  storage.pollChanges.mock.mockImplementationOnce(() => {
    throw failure
  })
  t.mock.timers.tick(2000)
  assert.deepEqual(errors, [{ error: failure, phase: 'poll' }])
  assert.deepEqual(calls, ['initial', 'poll', 'recovery'])
  t.mock.timers.tick(2000)
  assert.deepEqual(calls.slice(-2), ['recovery', 'poll'])
})

test('a repeating failure is reported once and again after a success', t => {
  const { service, storage, errors } = setup(t)
  service.start()
  storage.recover.mock.mockImplementationOnce(fail, 1)
  storage.recover.mock.mockImplementationOnce(fail, 2)
  t.mock.timers.tick(4000)
  assert.equal(errors.length, 1)
  t.mock.timers.tick(2000)
  storage.recover.mock.mockImplementationOnce(
    fail,
    storage.recover.mock.callCount()
  )
  t.mock.timers.tick(2000)
  assert.equal(errors.length, 2)
})
