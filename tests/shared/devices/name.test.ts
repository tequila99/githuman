import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanDeviceName } from '../../../src/shared/devices/name.ts'

test('cleanDeviceName drops control characters and cuts by code points', () => {
  assert.equal(cleanDeviceName(' Phone\n\u001b[2J\u009b '), 'Phone[2J')
  assert.equal(cleanDeviceName(undefined), '')
  const emoji = '😀'.repeat(70)
  assert.equal(Array.from(cleanDeviceName(emoji)).length, 64)
  assert.ok(!cleanDeviceName(emoji).includes('�'))
})
