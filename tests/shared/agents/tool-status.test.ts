import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AGENT_TOOL_STATUSES,
  toAgentToolStatus
} from '../../../src/shared/agents/types.ts'

test('each known status is returned as it is', () => {
  for (const status of AGENT_TOOL_STATUSES) {
    assert.equal(toAgentToolStatus(status), status)
  }
})

test('anything else — unknown, empty, null, undefined — gives undefined', () => {
  for (const value of ['done', '', 'PENDING', 'in-progress', null, undefined]) {
    assert.equal(toAgentToolStatus(value), undefined, String(value))
  }
})

test('the list matches what the browser shows (no status added or lost silently)', () => {
  assert.deepEqual(
    [...AGENT_TOOL_STATUSES],
    ['pending', 'in_progress', 'completed', 'failed']
  )
})
