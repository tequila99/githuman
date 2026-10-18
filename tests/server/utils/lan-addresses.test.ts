import assert from 'node:assert/strict'
import { isIP } from 'node:net'
import { test } from 'node:test'
import { lanAddresses } from '../../../src/server/utils/lan-addresses.ts'

test('lanAddresses is empty for a loopback bind', () => {
  assert.deepEqual(lanAddresses('localhost'), [])
  assert.deepEqual(lanAddresses('127.0.0.1'), [])
})

test('lanAddresses skips loopback and link-local, and IPv6 on 0.0.0.0', () => {
  for (const address of lanAddresses('0.0.0.0')) {
    assert.equal(isIP(address), 4, address)
    assert.ok(!address.startsWith('127.') && !address.startsWith('169.254.'))
  }
  for (const address of lanAddresses('::')) {
    assert.ok(!/^fe[89ab]/i.test(address) && address !== '::1', address)
  }
})
