import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorMessage } from '../../../src/shared/utils/error-message.ts'

class CustomError extends Error {}

test('an Error gives its message, subclasses included', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom')
  assert.equal(errorMessage(new CustomError('custom')), 'custom')
})

test('anything else is stringified', () => {
  assert.equal(errorMessage('plain'), 'plain')
  assert.equal(errorMessage(42), '42')
  assert.equal(errorMessage(undefined), 'undefined')
  assert.equal(errorMessage(null), 'null')
  assert.equal(errorMessage({ toString: () => 'object' }), 'object')
})
