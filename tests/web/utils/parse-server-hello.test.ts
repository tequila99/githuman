import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseServerHello } from '@/utils/parse-server-hello'

test('a well-formed greeting yields just the instanceId', () => {
  assert.deepEqual(
    parseServerHello(JSON.stringify({ instanceId: 'a', extra: 1 })),
    { instanceId: 'a' }
  )
})

test('anything else is rejected', () => {
  for (const data of [
    undefined,
    42,
    'not json',
    'null',
    '[]',
    '"a"',
    '{}',
    JSON.stringify({ instanceId: 7 }),
    JSON.stringify({ instanceId: null })
  ]) {
    assert.equal(parseServerHello(data), null, String(data))
  }
})
