import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressUrl } from '../../../src/shared/network/address-url.ts'

test('addressUrl brackets IPv6', () => {
  assert.equal(addressUrl('192.168.1.10', 3847), 'http://192.168.1.10:3847')
  assert.equal(addressUrl('fd00::5', 3847), 'http://[fd00::5]:3847')
})
