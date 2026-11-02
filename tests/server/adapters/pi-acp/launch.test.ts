import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  localPiLaunch,
  isLocalPiLaunch
} from '../../../../src/server/adapters/pi-acp/launch.ts'
import { AgentSession } from '../../../../src/server/services/agent/agent-session.ts'

test('trusted local launch is bound to executable and arguments, including custom preset IDs', () => {
  const preset = {
    id: 'custom-pi',
    title: 'Custom pi',
    ...localPiLaunch(),
    autoApprovesEdits: true
  }
  assert.equal(isLocalPiLaunch(preset), true)
  assert.equal(
    isLocalPiLaunch({ ...preset, args: [...preset.args, '--profile=chat'] }),
    false
  )
  assert.equal(isLocalPiLaunch({ ...preset, command: 'node' }), false)
})

test('legacy pi validator override is rejected before spawn', async () => {
  const session = new AgentSession({
    preset: {
      id: 'pi',
      title: 'pi',
      command: 'githuman-must-never-spawn',
      args: [],
      autoApprovesEdits: true
    },
    name: 'Validation',
    kind: 'validation',
    cwd: process.cwd(),
    permissionPolicy: () => ({ allow: false, reason: 'test' })
  })
  await session.start()
  assert.equal(session.status, 'closed')
  assert.match(session.info().error ?? '', /trusted local GitHuman pi launcher/)
})
