import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { detectServerRestart } from '@/utils/detect-server-restart'

test('the first greeting only records the server instance', () => {
  const onRestart = mock.fn()
  const handle = detectServerRestart(onRestart)

  handle({ instanceId: 'a' })

  assert.equal(onRestart.mock.callCount(), 0)
})

test('reconnecting to the same instance (network blip) does not restart', () => {
  const onRestart = mock.fn()
  const handle = detectServerRestart(onRestart)

  handle({ instanceId: 'a' })
  handle({ instanceId: 'a' })

  assert.equal(onRestart.mock.callCount(), 0)
})

test('a different instance after reconnect triggers onRestart exactly once', () => {
  const onRestart = mock.fn()
  const handle = detectServerRestart(onRestart)

  handle({ instanceId: 'a' })
  handle({ instanceId: 'b' })
  handle({ instanceId: 'c' }) // e.g. restarted again before the reload landed

  assert.equal(onRestart.mock.callCount(), 1)
})
