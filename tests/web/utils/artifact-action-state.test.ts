import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  actionAvailability,
  type ArtifactActionFlags
} from '@/utils/artifact-action-state'
import type { ArtifactActionInspection } from '@/api/types'

const FLAGS: ArtifactActionFlags = {
  confirmed: true,
  stale: false,
  loading: false,
  busy: false,
  expired: false
}
function inspection(
  patch: Partial<ArtifactActionInspection> = {}
): ArtifactActionInspection {
  return {
    phase: 'pending',
    ready: true,
    canExecute: false,
    ...patch
  } as ArtifactActionInspection
}

test('nothing is available without a state or an inspection', () => {
  assert.equal(actionAvailability(null, inspection()).canApprove, false)
  assert.equal(actionAvailability(FLAGS, null).canApprove, false)
})
test('approval needs a confirmed, fresh and ready pending scope', () => {
  assert.equal(actionAvailability(FLAGS, inspection()).canApprove, true)
  for (const patch of [
    { confirmed: false },
    { stale: true },
    { loading: true },
    { busy: true },
    { expired: true }
  ]) {
    assert.equal(
      actionAvailability({ ...FLAGS, ...patch }, inspection()).canApprove,
      false,
      JSON.stringify(patch)
    )
  }
  assert.equal(
    actionAvailability(FLAGS, inspection({ ready: false })).canApprove,
    false
  )
  assert.equal(
    actionAvailability(FLAGS, inspection({ phase: 'authorized' })).canApprove,
    false
  )
})
test('only a user-owned authorized scope can be applied', () => {
  const owned = inspection({ phase: 'authorized', canExecute: true })
  assert.equal(actionAvailability(FLAGS, owned).canExecute, true)
  assert.equal(
    actionAvailability({ ...FLAGS, busy: true }, owned).canExecute,
    false
  )
  assert.equal(
    actionAvailability(FLAGS, inspection({ canExecute: true })).canExecute,
    false
  )
})
test('an agent-owned grant is reported as passed to the agent', () => {
  const agent = inspection({ phase: 'authorized', canExecute: false })
  const result = actionAvailability(FLAGS, agent)
  assert.equal(result.grantedToAgent, true)
  assert.equal(result.canExecute, false)
  assert.equal(actionAvailability(FLAGS, inspection()).grantedToAgent, false)
})
