import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOnPath } from '../../../src/server/utils/executable.ts'

test('isOnPath handles absolute paths and PATH lookups', () => {
  assert.ok(isOnPath(process.execPath))
  assert.ok(!isOnPath('/definitely/not/here'))
  assert.ok(isOnPath('node', process.execPath.replace(/\/node$/, '')))
  assert.ok(!isOnPath('node', ''))
})
