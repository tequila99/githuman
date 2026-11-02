import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiRequestError } from '@/api/client'
import { ArtifactContentError } from '@/utils/artifact-content'
import {
  canStartTransition,
  canUseOriginal,
  classifyContentError
} from '@/utils/artifact-content-state'

test('errors are classified by type and code, never by message text', () => {
  const abort = new DOMException('stopped', 'AbortError')
  assert.equal(classifyContentError(abort), 'abort')
  assert.equal(
    classifyContentError(new ArtifactContentError('anything')),
    'integrity'
  )
  assert.equal(
    classifyContentError(
      new ApiRequestError('changed wording', 422, 'GHT_ARTIFACT_INTEGRITY')
    ),
    'integrity'
  )
  // The words of a message do not make an integrity error.
  assert.equal(
    classifyContentError(new ApiRequestError('integrity failed', 422)),
    'transport'
  )
  assert.equal(
    classifyContentError(new Error('The artifact content does not match')),
    'transport'
  )
  assert.equal(classifyContentError(new ApiRequestError('no', 401)), 'access')
  assert.equal(classifyContentError(new ApiRequestError('no', 403)), 'access')
  assert.equal(
    classifyContentError(new ApiRequestError('down', 500)),
    'transport'
  )
  assert.equal(classifyContentError(new TypeError('network')), 'transport')
})

test('an old ApiRequestError constructor call keeps working without a code', () => {
  const error = new ApiRequestError('plain', 404)
  assert.equal(error.status, 404)
  assert.equal(error.code, undefined)
})

test('only verified content starts a transition and only known corruption blocks the original', () => {
  assert.equal(canStartTransition('ready'), true)
  for (const state of ['idle', 'loading', 'error'] as const) {
    assert.equal(canStartTransition(state), false)
  }
  assert.equal(canUseOriginal('integrity'), false)
  for (const kind of ['transport', 'access', 'abort', null] as const) {
    assert.equal(canUseOriginal(kind), true)
  }
})
