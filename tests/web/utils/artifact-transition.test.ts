import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasValidationResult } from '@/utils/artifact-transition'

test('the validation result is offered only for readable verdicts', () => {
  const id = '00000000-0000-4000-8000-000000000003'
  assert.equal(
    hasValidationResult({ validationId: id, verdict: 'conflict' }),
    true
  )
  assert.equal(
    hasValidationResult({ validationId: id, verdict: 'incomplete' }),
    true
  )
  assert.equal(hasValidationResult({ validationId: id, verdict: 'pass' }), true)
  assert.equal(
    hasValidationResult({ validationId: id, verdict: 'cancelled' }),
    false
  )
  assert.equal(
    hasValidationResult({ validationId: id, verdict: 'running' }),
    false
  )
  assert.equal(hasValidationResult({ validationId: id, verdict: null }), false)
  assert.equal(
    hasValidationResult({ validationId: null, verdict: 'conflict' }),
    false
  )
})
