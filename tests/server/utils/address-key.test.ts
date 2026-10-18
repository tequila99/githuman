import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressKey } from '../../../src/server/utils/address-key.ts'

test('addressKey maps IPv6 to its /64 prefix and keeps IPv4', () => {
  assert.equal(addressKey('192.168.1.5'), '192.168.1.5')
  assert.equal(addressKey('::ffff:192.168.1.5'), '192.168.1.5')
  assert.equal(addressKey('2001:db8:1:2::1'), '2001:db8:1:2::/64')
  assert.equal(
    addressKey('2001:DB8:0001:0002:aaaa:bbbb:cccc:dddd'),
    '2001:db8:1:2::/64'
  )
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64')
  assert.equal(addressKey('::1'), '0:0:0:0::/64')
  assert.equal(addressKey('not-an-ip'), 'not-an-ip')
})
