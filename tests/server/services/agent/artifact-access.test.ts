import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { createSessionRegistry } from '../../../../src/server/services/agent/session-registry.ts'
import { createTestDatabase } from '../../../../src/server/db/index.ts'
import { DeviceService } from '../../../../src/server/services/device.service.ts'
import { DeviceConnections } from '../../../../src/server/services/device-connections.ts'
import { DEVICE_IDLE_TTL_MS } from '../../../../src/shared/devices/constants.ts'

// The process starts normally; the device can be revoked during the handshake.
const PRESET = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [join(import.meta.dirname, '../../fixtures/fake-acp-agent.ts')],
  autoApprovesEdits: false
}

test('owner revoke and expiry close sessions and abort their registered HTTP requests', t => {
  for (const expiry of [false, true]) {
    let now = Date.now()
    const db = createTestDatabase()
    const devices = new DeviceService(db, { now: () => now })
    const connections = new DeviceConnections(devices)
    const registry = createSessionRegistry({
      presets: [PRESET],
      repositoryPath: process.cwd(),
      connections
    })
    t.after(() => {
      registry.closeAll()
      db.close()
    })
    const { device } = devices.createRequest({
      address: '192.168.10.3',
      host: '192.168.10.2:3847'
    })
    devices.approve(device.id, device.code)
    const session = registry.create('fake', null, undefined, device.id)
    let cancelled = 0
    registry.trackArtifactRequest(session.id, () => cancelled++)
    if (expiry) {
      now += DEVICE_IDLE_TTL_MS
      connections.recheck()
    } else {
      devices.revoke(device.id)
    }
    assert.equal(session.status, 'closed')
    assert.equal(cancelled, 1)
    assert.equal(connections.count(device.id), 0)
    assert.equal(
      registry.authenticateArtifactKey('Bearer ' + '0'.repeat(64)),
      undefined
    )
  }
})

test('a repeated release of one request does not drop a newer request from revoke', t => {
  const registry = createSessionRegistry({
    presets: [PRESET],
    repositoryPath: process.cwd()
  })
  t.after(() => registry.closeAll())
  const session = registry.create('fake', null)
  let cancelled = 0
  const releaseFirst = registry.trackArtifactRequest(session.id, () => {})
  releaseFirst()
  registry.trackArtifactRequest(session.id, () => cancelled++)
  // The response of the first request fires both finish and close.
  releaseFirst()
  session.close()
  assert.equal(cancelled, 1)
})
