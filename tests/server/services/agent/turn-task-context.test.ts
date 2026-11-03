import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createSessionRegistry } from '../../../../src/server/services/agent/session-registry.ts'

// A real subprocess keeps prompt completion and cancellation asynchronous.
const PRESET = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [join(import.meta.dirname, '../../fixtures/fake-acp-agent.ts')],
  autoApprovesEdits: false
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'agent timeout')
    await delay(20)
  }
}

test('turn snapshots are immutable, session-local and refreshed only when accepting a prompt', async t => {
  const assignments = new Map<string, { version: number; taskIds: string[] }>()
  const registry = createSessionRegistry({
    presets: [PRESET],
    repositoryPath: process.cwd(),
    taskAssignment: id => assignments.get(id) ?? { version: 0, taskIds: [] }
  })
  t.after(() => registry.closeAll())
  const a = registry.create('fake', null),
    b = registry.create('fake', null)
  await until(() => a.status === 'ready' && b.status === 'ready')
  const context = () => a.turnTaskContext
  const original = { version: 3, taskIds: ['A'] }
  assignments.set(a.id, original)
  assignments.set(b.id, { version: 8, taskIds: ['B'] })
  a.prompt([{ type: 'text', text: 'slow' }], { text: 'slow' })
  b.prompt([{ type: 'text', text: 'slow' }], { text: 'slow' })
  const snapshot = context()!
  assert.equal(snapshot.sessionId, a.id)
  assert.equal(snapshot.assignmentVersion, 3)
  assert.deepEqual(snapshot.taskIds, ['A'])
  assert.deepEqual(b.turnTaskContext?.taskIds, ['B'])
  assert.notEqual(snapshot.turnId, b.turnTaskContext?.turnId)
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.taskIds))
  original.taskIds.push('changed')
  assignments.set(a.id, { version: 4, taskIds: ['C'] })
  assert.deepEqual(context()?.taskIds, ['A'])
  assert.throws(() => a.prompt([], { text: 'duplicate' }))
  assert.equal(context(), snapshot)
  await a.cancel()
  assert.equal(context(), undefined)
  assert.deepEqual(b.turnTaskContext?.taskIds, ['B'])
  await until(() => a.status === 'ready')
  a.prompt([{ type: 'text', text: 'hello' }], { text: 'hello' })
  assert.deepEqual(context()?.taskIds, ['C'])
  assert.equal(context()?.assignmentVersion, 4)
  assert.notEqual(context()?.turnId, snapshot.turnId)
  await until(() => a.status === 'ready')
  assert.equal(context(), undefined)
  b.close()
  assert.equal(b.turnTaskContext, undefined)
})

for (const prompt of ['askfail', 'crash']) {
  test(`${prompt} clears task context on error`, async t => {
    const registry = createSessionRegistry({
      presets: [PRESET],
      repositoryPath: process.cwd(),
      taskAssignment: () => ({ version: 1, taskIds: ['A'] })
    })
    t.after(() => registry.closeAll())
    const session = registry.create('fake', null)
    await until(() => session.status === 'ready')
    session.prompt([{ type: 'text', text: prompt }], { text: prompt })
    assert.ok(session.turnTaskContext)
    await until(() => session.status !== 'busy')
    assert.equal(session.turnTaskContext, undefined)
  })
}
