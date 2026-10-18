import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyRequest } from 'fastify'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { DeviceConnections } from '../../../src/server/services/device-connections.ts'
import { DeviceService } from '../../../src/server/services/device.service.ts'
import { DEVICE_IDLE_TTL_MS } from '../../../src/shared/devices/constants.ts'

function setup() {
  const clock = { now: Date.parse('2026-10-17T10:00:00.000Z') }
  const db = createTestDatabase()
  const devices = new DeviceService(db, {
    now: () => clock.now
  })
  const connections = new DeviceConnections(devices)
  const { device, secret } = devices.createRequest({
    address: '192.168.1.5',
    host: '192.168.1.10:3847'
  })
  devices.approve(device.id, device.code)
  // The request as the access hook left it.
  const access = devices.access(secret)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the registry reads only `access`
  const request = { access: { local: false, device: access } } as FastifyRequest
  return { clock, db, devices, connections, id: device.id, request }
}

test('revoke closes every connection of the device once', () => {
  const ctx = setup()
  let closed = 0
  ctx.connections.track(ctx.request, () => closed++)
  ctx.connections.track(ctx.request, () => closed++)
  assert.equal(ctx.connections.count(ctx.id), 2)
  ctx.devices.revoke(ctx.id)
  assert.equal(closed, 2)
  assert.equal(ctx.connections.count(ctx.id), 0)
  ctx.connections.closeDevice(ctx.id)
  assert.equal(closed, 2)
})

test('a revoke between the access hook and the registration closes the connection', () => {
  const ctx = setup()
  // The hook let the request through; the device lost access during an `await`.
  ctx.devices.revoke(ctx.id)
  let closed = 0
  const release = ctx.connections.track(ctx.request, () => closed++)
  assert.equal(release, undefined)
  assert.equal(closed, 1)
  assert.equal(ctx.connections.count(ctx.id), 0)
})

test('expiry closes open connections through the revoke path', () => {
  const ctx = setup()
  let closed = 0
  ctx.connections.track(ctx.request, () => closed++)
  ctx.clock.now += DEVICE_IDLE_TTL_MS
  assert.deepEqual(ctx.devices.removeExpired(), [ctx.id])
  assert.equal(closed, 1)
})

test('release forgets a closed connection; local requests are not tracked', () => {
  const ctx = setup()
  let closed = 0
  const release = ctx.connections.track(ctx.request, () => closed++)
  release?.()
  ctx.devices.revoke(ctx.id)
  assert.equal(closed, 0)

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the registry reads only `access`
  const local = {
    access: { local: true, device: { status: 'none' } }
  } as FastifyRequest
  let localClosed = 0
  assert.ok(ctx.connections.track(local, () => localClosed++))
  assert.equal(localClosed, 0)
})

test('a request without device access is closed at once', () => {
  const ctx = setup()
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the registry reads only `access`
  const none = {
    access: { local: false, device: { status: 'none' } }
  } as FastifyRequest
  let closed = 0
  assert.equal(
    ctx.connections.track(none, () => closed++),
    undefined
  )
  assert.equal(closed, 1)
})

test('recheck closes connections of a device removed by another process', () => {
  const ctx = setup()
  let closed = 0
  ctx.connections.track(ctx.request, () => closed++)
  // Another process deletes the row; this service gets no event.
  const other = new DeviceService(ctx.db)
  other.revoke(ctx.id)
  assert.equal(closed, 0)
  ctx.connections.recheck()
  assert.equal(closed, 1)
  ctx.connections.recheck()
  assert.equal(closed, 1)
})
