import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { DeviceService } from '../../../src/server/services/device.service.ts'
import {
  DEVICE_IDLE_TTL_MS,
  DEVICE_TOUCH_INTERVAL_MS,
  MAX_PAIRING_REQUESTS_PER_MINUTE,
  MAX_PENDING_REQUESTS,
  PAIRING_REQUEST_INTERVAL_MS,
  PAIRING_REQUEST_TTL_MS
} from '../../../src/shared/devices/constants.ts'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

function setup() {
  const clock = { now: Date.parse('2026-10-17T10:00:00.000Z') }
  const db = createTestDatabase()
  let changes = 0
  const service = new DeviceService(db, {
    now: () => clock.now,
    onChange: () => changes++
  })
  const removed: string[] = []
  service.onRemoved(id => removed.push(id))
  const request = (address = '192.168.1.5', secret?: string) =>
    service.createRequest({
      address,
      host: '192.168.1.10:3847',
      userAgent: IPHONE,
      ...(secret === undefined ? {} : { secret })
    })
  return {
    db,
    clock,
    service,
    removed,
    request,
    changes: () => changes
  }
}

function pair(ctx: ReturnType<typeof setup>, address?: string) {
  const { device, secret } = ctx.request(address)
  assert.ok(secret)
  ctx.service.approve(device.id, device.code)
  return { id: device.id, secret }
}

test('a request creates a pending device with a code and a name from the User-Agent', () => {
  const ctx = setup()
  const { device, secret } = ctx.request()
  assert.equal(device.state, 'pending')
  assert.match(device.code, /^\d{6}$/)
  assert.equal(device.name, 'Safari on iPhone')
  assert.equal(secret?.length, 43)
  assert.notEqual(device.secretHash, secret)
  assert.equal(
    Date.parse(device.expiresAt) - ctx.clock.now,
    PAIRING_REQUEST_TTL_MS
  )
  assert.equal(ctx.service.access(secret).status, 'pending')
  assert.equal(ctx.changes(), 1)
})

test('the server id is stable for one database', () => {
  const ctx = setup()
  assert.equal(new DeviceService(ctx.db).serverId, ctx.service.serverId)
})

test('approval needs the right code and makes the device trusted', () => {
  const ctx = setup()
  const { device, secret } = ctx.request()
  const wrong = device.code === '000000' ? '111111' : '000000'
  assert.throws(() => ctx.service.approve(device.id, wrong), {
    statusCode: 409
  })
  ctx.service.approve(device.id, device.code)
  const access = ctx.service.access(secret)
  assert.equal(access.status, 'device')
  // A second localhost tab approves the same record.
  assert.throws(() => ctx.service.approve(device.id, device.code), {
    statusCode: 409
  })
  assert.throws(() => ctx.service.approve('unknown', device.code), {
    statusCode: 404
  })
})

test('an expired pending request gives 410 when found and no access', () => {
  const ctx = setup()
  const { device, secret } = ctx.request()
  ctx.clock.now += PAIRING_REQUEST_TTL_MS
  assert.equal(ctx.service.access(secret).status, 'none')
  assert.throws(() => ctx.service.approve(device.id, device.code), {
    statusCode: 410
  })
  // Cleanup removes it; then the same call is 404.
  ctx.service.list()
  assert.throws(() => ctx.service.approve(device.id, device.code), {
    statusCode: 404
  })
})

test('approval one second before the deadline keeps the browser cookie valid', () => {
  const ctx = setup()
  const { device, secret } = ctx.request()
  ctx.clock.now += PAIRING_REQUEST_TTL_MS - 1000
  ctx.service.approve(device.id, device.code)
  ctx.clock.now += PAIRING_REQUEST_TTL_MS
  assert.equal(ctx.service.access(secret).status, 'device')
})

test('a new request from the same address or cookie replaces the old one', () => {
  const ctx = setup()
  const first = ctx.request('192.168.1.5')
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  const second = ctx.request('192.168.1.5')
  assert.deepEqual(ctx.removed, [first.device.id])
  assert.equal(ctx.service.access(first.secret).status, 'none')
  assert.throws(() => ctx.service.approve(first.device.id, first.device.code), {
    statusCode: 404
  })
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  const third = ctx.request('192.168.1.6', second.secret)
  assert.deepEqual(ctx.removed, [first.device.id, second.device.id])
  assert.deepEqual(
    ctx.service.list().map(device => device.id),
    [third.device.id]
  )
})

test('a trusted browser gets its device back instead of a new request', () => {
  const ctx = setup()
  const { id, secret } = pair(ctx)
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  const again = ctx.request('192.168.1.5', secret)
  assert.equal(again.device.id, id)
  assert.equal(again.secret, undefined)
  assert.equal(ctx.service.list().length, 1)
})

test('requests are limited per address and per minute', () => {
  const ctx = setup()
  ctx.request('10.0.0.1')
  assert.throws(() => ctx.request('10.0.0.1'), { statusCode: 429 })

  const burst = setup()
  for (let index = 0; index < MAX_PAIRING_REQUESTS_PER_MINUTE; index++) {
    burst.request(`10.0.3.${index}`)
    // Keep the pending count below its limit.
    burst.service.list().forEach(device => burst.service.revoke(device.id))
  }
  assert.throws(() => burst.request('10.0.4.1'), { statusCode: 429 })
  burst.clock.now += 60 * 1000
  assert.equal(burst.request('10.0.4.1').device.state, 'pending')
})

test('a full pending list drops the oldest request for a new one', () => {
  const ctx = setup()
  const first = ctx.request('10.0.1.0').device
  for (let index = 1; index < MAX_PENDING_REQUESTS; index++) {
    ctx.clock.now += 1
    ctx.request(`10.0.1.${index}`)
  }
  ctx.clock.now += 1
  const fresh = ctx.request('10.0.2.1').device
  const ids = ctx.service.list().map(device => device.id)
  assert.equal(ids.length, MAX_PENDING_REQUESTS)
  assert.ok(!ids.includes(first.id))
  assert.ok(ids.includes(fresh.id))
  assert.deepEqual(ctx.removed, [first.id])
})

test('IPv6 addresses of one /64 share the request limit and replace each other', () => {
  const ctx = setup()
  ctx.request('2001:db8:1:2::1')
  assert.throws(() => ctx.request('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), {
    statusCode: 429
  })
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  ctx.request('2001:DB8:1:2::7')
  assert.equal(ctx.service.list().length, 1)
  ctx.request('2001:db8:1:3::1')
  assert.equal(ctx.service.list().length, 2)
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  ctx.request('::ffff:10.0.0.9')
  ctx.clock.now += PAIRING_REQUEST_INTERVAL_MS
  ctx.request('10.0.0.9')
  assert.equal(ctx.service.list().length, 3)
})

test('activity renews a trusted device at most once per interval', () => {
  const ctx = setup()
  const { secret } = pair(ctx)
  const first = ctx.service.access(secret, '192.168.1.7')
  assert.equal(first.status === 'device' && first.renewed, false)
  ctx.clock.now += DEVICE_TOUCH_INTERVAL_MS
  const renewed = ctx.service.access(secret, '192.168.1.7')
  assert.ok(renewed.status === 'device' && renewed.renewed)
  assert.equal(renewed.device.address, '192.168.1.7')
  assert.equal(
    Date.parse(renewed.device.expiresAt) - ctx.clock.now,
    DEVICE_IDLE_TTL_MS
  )
})

test('an idle device expires and the sweep removes it through the revoke path', () => {
  const ctx = setup()
  const { id, secret } = pair(ctx)
  ctx.clock.now += DEVICE_IDLE_TTL_MS
  assert.equal(ctx.service.access(secret).status, 'none')
  assert.equal(ctx.service.isTrusted(id), false)
  assert.deepEqual(ctx.service.removeExpired(), [id])
  assert.deepEqual(ctx.removed, [id])
})

test('revoke removes the device once; unknown and malformed secrets give none', () => {
  const ctx = setup()
  const { id, secret } = pair(ctx)
  assert.equal(ctx.service.isTrusted(id), true)
  ctx.service.revoke(id)
  assert.equal(ctx.service.access(secret).status, 'none')
  assert.deepEqual(ctx.removed, [id])
  assert.throws(() => ctx.service.revoke(id), { statusCode: 404 })
  assert.equal(ctx.service.access(undefined).status, 'none')
  assert.equal(ctx.service.access('short').status, 'none')
  assert.equal(ctx.service.access('x'.repeat(43)).status, 'none')
})

test('a pending secret never passes isTrusted', () => {
  const ctx = setup()
  const { device } = ctx.request()
  assert.equal(ctx.service.isTrusted(device.id), false)
})

test('rename trims and limits the name', () => {
  const ctx = setup()
  const { id } = pair(ctx)
  assert.equal(ctx.service.rename(id, '  Phone  ').name, 'Phone')
  assert.equal(ctx.service.rename(id, 'x'.repeat(100)).name.length, 64)
  assert.throws(() => ctx.service.rename('unknown', 'x'), { statusCode: 404 })
})
