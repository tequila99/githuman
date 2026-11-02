import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Value } from '@sinclair/typebox/value'
import { isValidArtifactTypeId } from '../../../src/shared/utils/is-valid-artifact-type-id.ts'
import { ArtifactTypeCreateBody } from '../../../src/shared/tasks/schemas.ts'

// Cover the shared rule through both callers so the HTTP contract cannot drift.
function assertValidId(value: unknown, expected: boolean): void {
  assert.equal(isValidArtifactTypeId(value), expected, JSON.stringify(value))
  assert.equal(
    Value.Check(ArtifactTypeCreateBody, {
      requestId: 'create-type',
      id: value,
      input: { label: 'Custom type', active: true }
    }),
    expected,
    JSON.stringify(value)
  )
}

test('artifact type IDs accept built-in names and lowercase custom identifiers', () => {
  for (const id of [
    'generic',
    'plan',
    'review',
    'research',
    'prd',
    'adr',
    'proposal',
    'specification',
    'report',
    'a',
    'a0',
    'decision-record',
    'custom_type_2',
    'a_-'
  ]) {
    assertValidId(id, true)
  }
})

test('artifact type IDs require between 1 and 100 characters', () => {
  assertValidId('', false)
  assertValidId('a'.repeat(100), true)
  assertValidId('a'.repeat(101), false)
})

test('artifact type IDs must start with a lowercase ASCII letter', () => {
  for (const id of [
    'Plan',
    'pLan',
    '1plan',
    '-plan',
    '_plan',
    'план',
    '文档'
  ]) {
    assertValidId(id, false)
  }
})

test('artifact type IDs reject whitespace, path characters and control characters anywhere', () => {
  for (const character of [
    ' ',
    '.',
    '/',
    '\\',
    ':',
    '🧪',
    '\t',
    '\n',
    '\r',
    '\0'
  ]) {
    for (const id of [
      `${character}plan`,
      `pl${character}an`,
      `plan${character}`
    ]) {
      assertValidId(id, false)
    }
  }
  assertValidId('plan\r\n', false)
  assertValidId('plan\u2028', false)
  assertValidId('plan\u2029', false)
})

test('artifact type IDs reject values that are not strings', () => {
  for (const value of [null, undefined, 123, true, {}, ['plan']]) {
    assertValidId(value, false)
  }
})
