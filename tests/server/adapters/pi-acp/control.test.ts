import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import {
  JsonChannel,
  MAX_CONTROL_BYTES
} from '../../../../src/server/adapters/pi-acp/control.ts'

test('control parses fragmented UTF-8 frames and fails closed on missing nonce', () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const received: unknown[] = []
  let failures = 0
  const channel = new JsonChannel(
    input,
    output,
    frame => received.push(frame),
    () => {
      failures++
    }
  )
  const bytes = Buffer.from(
    JSON.stringify({ type: 'hello', nonce: 'одноразовый', version: 1 }) + '\n'
  )
  input.write(bytes.subarray(0, 35))
  input.write(bytes.subarray(35))
  assert.equal(received.length, 1)
  input.write('{"type":"hello","version":1}\n')
  assert.equal(failures, 1)
  assert.throws(
    () => channel.send({ type: 'result', nonce: 'nonce', version: 1 }),
    /closed/
  )
})

test('control rejects oversized partial frames without a newline', () => {
  const input = new PassThrough()
  let failed = false
  const channel = new JsonChannel(
    input,
    new PassThrough(),
    () => assert.fail('oversized frame accepted'),
    () => {
      failed = true
    }
  )
  input.write(Buffer.alloc(MAX_CONTROL_BYTES + 1))
  assert.equal(failed, true)
  channel.close()
})
