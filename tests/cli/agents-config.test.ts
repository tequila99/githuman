import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAgentsConfigPath } from '../../src/cli/server-runtime.ts'

test('agent overrides live next to the DB and share its prefix', () => {
  assert.equal(
    resolveAgentsConfigPath('/repo', 'ght-'),
    '/repo/.githuman/ght-agents.json'
  )
  assert.equal(
    resolveAgentsConfigPath('/repo', ''),
    '/repo/.githuman/agents.json'
  )
})
