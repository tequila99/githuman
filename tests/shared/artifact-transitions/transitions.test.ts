import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARTIFACT_STATUSES } from '../../../src/shared/artifacts/constants.ts'
import {
  allowedTransition,
  transitionCommand,
  userTransitionTargets
} from '../../../src/shared/artifact-transitions/transitions.ts'

test('matrix allows exactly the documented transitions and no no-ops', () => {
  const allowed = ARTIFACT_STATUSES.flatMap(from =>
    ARTIFACT_STATUSES.filter(to => allowedTransition(from, to)).map(
      to => `${from}>${to}`
    )
  )
  assert.equal(allowed.length, 19)
  assert.ok(!allowed.some(item => item.split('>')[0] === item.split('>')[1]))
  assert.ok(allowedTransition('draft', 'accepted'))
  assert.ok(!allowedTransition('accepted', 'draft'))
  assert.ok(!allowedTransition('draft', 'rejected'))
})

test('commands follow the source status and never assign system statuses', () => {
  assert.equal(transitionCommand('draft', 'accepted'), 'accept')
  assert.equal(transitionCommand('in_review', 'rejected'), 'reject')
  assert.equal(transitionCommand('accepted', 'archived'), 'archive')
  assert.equal(transitionCommand('archived', 'deleted'), 'delete')
  assert.equal(transitionCommand('archived', 'draft'), 'restore')
  assert.equal(transitionCommand('deleted', 'draft'), 'restore')
  assert.equal(transitionCommand('rejected', 'draft'), 'return_to_draft')
  assert.equal(transitionCommand('in_review', 'draft'), 'return_to_draft')
  assert.equal(transitionCommand('draft', 'in_review'), null)
  assert.equal(transitionCommand('draft', 'superseded'), null)
  assert.equal(transitionCommand('accepted', 'draft'), null)
})

test('targets hide system statuses and explain draft after superseded history', () => {
  const targets = userTransitionTargets('archived', true)
  assert.deepEqual(
    targets.map(item => [item.status, item.available]),
    [
      ['draft', false],
      ['deleted', true]
    ]
  )
  assert.match(targets[0].reason ?? '', /new revision/)
  assert.deepEqual(
    userTransitionTargets('in_review', false).map(item => item.status),
    ['draft', 'rejected', 'accepted', 'archived', 'deleted']
  )
})
