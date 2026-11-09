import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { createSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'

// A slow real ACP response leaves time to exercise synchronous activation before completion.
const PRESET = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')],
  autoApprovesEdits: false
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'agent timeout')
    await delay(10)
  }
}
async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-activation-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const registry = createSessionRegistry({
    presets: [PRESET],
    repositoryPath: root,
    taskAssignment: id => storage.definitions.assignment(id),
    taskIds: id => storage.definitions.assignment(id).taskIds
  })
  storage.tasks.attachSessions(registry)
  t.after(() => {
    registry.closeAll()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const session = registry.create('fake', null)
  await until(() => session.status === 'ready')
  const actor = { kind: 'agent' as const, id: session.id }
  const input = { title: 'Task', externalUrl: null, state: 'open' as const }
  const task = storage.tasks.create('initial-task', input, actor)
  function prompt() {
    session.prompt([{ type: 'text', text: 'slow' }], { text: 'slow' })
  }
  function activation(taskId = task.id) {
    const context = storage.tasks.getContext(actor)
    assert.ok(context.turnId)
    return {
      requestId: randomUUID(),
      turnId: context.turnId,
      assignmentVersion: context.assignment.version,
      taskId
    }
  }
  function createArtifact(name: string, taskIds?: string[]) {
    return storage.create(
      {
        requestId: name,
        body: '# Body',
        metadata: {
          title: name,
          tags: [],
          ...(taskIds === undefined ? {} : { taskIds })
        }
      },
      actor,
      session.turnTaskContext
    )
  }
  return {
    root,
    db,
    storage,
    registry,
    session,
    actor,
    input,
    task,
    prompt,
    activation,
    createArtifact
  }
}

test('create-only leaves selection unchanged; activation replaces a frozen response context and preserves explicit overrides', async t => {
  const {
    storage,
    session,
    actor,
    task,
    input,
    prompt,
    activation,
    createArtifact
  } = await setup(t)
  assert.equal(storage.tasks.getContext(actor).turnId, null)
  assert.deepEqual(storage.tasks.getContext(actor).assignment.taskIds, [])
  prompt()
  const snapshot = session.turnTaskContext!
  const before = createArtifact('before')
  const another = storage.tasks.create(
    'backlog',
    { ...input, state: 'open' },
    actor
  )
  assert.equal(session.turnTaskContext, snapshot)
  assert.deepEqual(storage.tasks.assignment(session.id).taskIds, [])
  const request = activation(another.id)
  const result = storage.tasks.activate(request, actor)
  assert.equal(result.replayed, false)
  assert.deepEqual(result.assignment.taskIds, [another.id])
  assert.equal(result.task.state, 'open')
  assert.deepEqual(snapshot.taskIds, [])
  assert.notEqual(session.turnTaskContext, snapshot)
  assert.ok(
    Object.isFrozen(session.turnTaskContext) &&
      Object.isFrozen(session.turnTaskContext.taskIds)
  )
  assert.equal(session.turnTaskContext.source, 'turn_activation')
  assert.deepEqual(before.taskIds, [])
  assert.deepEqual(createArtifact('after').taskIds, [another.id])
  assert.deepEqual(createArtifact('explicit', [task.id]).taskIds, [task.id])
  assert.deepEqual(createArtifact('general', []).taskIds, [])
  assert.deepEqual(storage.catalog.operation('after')?.data.taskBinding, {
    source: 'turn_activation',
    sessionId: session.id,
    turnId: request.turnId,
    assignmentVersion: 1,
    activationRequestId: request.requestId
  })
  const repeated = storage.tasks.activate(activation(another.id), actor)
  assert.equal(repeated.assignment.version, 2)
  assert.equal(repeated.task.state, 'open')
})

test('create-and-activate commits both records and replay cannot undo later manual choices or a new response', async t => {
  const {
    root,
    db,
    storage,
    session,
    actor,
    task,
    input,
    prompt,
    activation,
    createArtifact
  } = await setup(t)
  prompt()
  const { taskId: _taskId, ...request } = activation()
  const create = { ...request, input: { ...input, title: 'New task' } }
  const result = storage.tasks.createAndActivate(create, actor)
  const firstSnapshot = session.turnTaskContext
  assert.deepEqual(createArtifact('first').taskIds, [result.task.id])
  const epoch = storage.catalog.epoch()
  assert.deepEqual(storage.tasks.createAndActivate(create, actor), {
    ...result,
    replayed: true
  })
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(storage.tasks.history(result.task.id).length, 1)
  assert.equal(session.turnTaskContext, firstSnapshot)
  storage.tasks.assignSession(
    session.id,
    { requestId: 'manual', expectedVersion: 1, taskIds: [task.id] },
    { kind: 'user', id: 'local' }
  )
  assert.equal(session.turnTaskContext, firstSnapshot)
  assert.deepEqual(createArtifact('still-current').taskIds, [result.task.id])
  await session.cancel()
  await until(() => session.status === 'ready')
  prompt()
  const next = session.turnTaskContext
  assert.deepEqual(next?.taskIds, [task.id])
  assert.deepEqual(storage.tasks.createAndActivate(create, actor), {
    ...result,
    replayed: true
  })
  assert.equal(session.turnTaskContext, next)
  assert.deepEqual(storage.tasks.assignment(session.id).taskIds, [task.id])
  assert.deepEqual(createArtifact('first').taskIds, [result.task.id])
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  assert.deepEqual(restarted.tasks.createAndActivate(create, actor), {
    ...result,
    replayed: true
  })
  assert.throws(
    () =>
      storage.tasks.createAndActivate(
        { ...create, input: { ...create.input, title: 'Other' } },
        actor
      ),
    /different operation/
  )
  assert.throws(
    () =>
      storage.tasks.createAndActivate(create, { kind: 'agent', id: 'other' }),
    /different operation/
  )
})

test('stale assignment and turn reject the whole command; different sessions stay independent', async t => {
  const { storage, registry, session, actor, input, task, prompt, activation } =
    await setup(t)
  prompt()
  const stale = activation()
  storage.tasks.assignSession(
    session.id,
    { requestId: 'manual', expectedVersion: 0, taskIds: [task.id] },
    { kind: 'user', id: 'local' }
  )
  const before = storage.tasks.list().items.length
  const { taskId: _taskId, ...request } = stale
  assert.throws(
    () => storage.tasks.createAndActivate({ ...request, input }, actor),
    /assignment changed/
  )
  assert.equal(storage.tasks.list().items.length, before)
  assert.throws(
    () =>
      storage.tasks.activate({ ...activation(), turnId: randomUUID() }, actor),
    /response ended|context changed/
  )
  const other = registry.create('fake', null)
  await until(() => other.status === 'ready')
  assert.throws(
    () =>
      storage.tasks.activate(
        { ...activation(), assignmentVersion: 0 },
        { kind: 'agent', id: other.id }
      ),
    /response ended|context changed/
  )
  assert.deepEqual(storage.tasks.assignment(other.id).taskIds, [])
  assert.throws(
    () => storage.tasks.getContext({ kind: 'user', id: session.id }),
    /own live agent/
  )
})

test('cancel clears task context immediately while busy; late activation before stop cannot restore it', async t => {
  const { storage, session, actor, prompt, activation } = await setup(t)
  prompt()
  const request = activation()
  const cancelled = session.cancel()
  assert.equal(session.status, 'busy')
  assert.equal(storage.tasks.getContext(actor).turnId, null)
  assert.throws(
    () => storage.tasks.activate(request, actor),
    /response ended|context changed/
  )
  assert.equal(session.turnTaskContext, undefined)
  assert.equal(storage.tasks.assignment(session.id).version, 0)
  await cancelled
})

for (const table of [
  'task_versions',
  'task_chat_link_events',
  'artifact_definition_operations'
]) {
  test(
    'create-and-activate rolls back task, selection and context on failure writing ' +
      table,
    async t => {
      const { db, storage, session, actor, input, prompt, activation } =
        await setup(t)
      prompt()
      const snapshot = session.turnTaskContext
      const before = storage.tasks.list().items.length
      const epoch = storage.catalog.epoch()
      const { taskId: _taskId, ...request } = activation()
      db.exec(
        `CREATE TEMP TRIGGER fail_activation BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'activation write failed'); END`
      )
      assert.throws(
        () => storage.tasks.createAndActivate({ ...request, input }, actor),
        /activation write failed/
      )
      assert.equal(storage.tasks.list().items.length, before)
      assert.equal(storage.tasks.assignment(session.id).version, 0)
      assert.equal(storage.catalog.epoch(), epoch)
      assert.equal(session.turnTaskContext, snapshot)
      db.exec('DROP TRIGGER fail_activation')
      const result = storage.tasks.createAndActivate(
        { ...request, input },
        actor
      )
      assert.equal(result.replayed, false)
      assert.equal(result.assignment.version, 1)
    }
  )
}

test('sequential activation requests use assignment CAS; all notifications observe committed context', async t => {
  const { storage, registry, session, actor, prompt, activation } =
    await setup(t)
  prompt()
  const request = activation()
  const seen: unknown[] = []
  registry.subscribe(event => {
    if (event.type === 'sessions') {
      seen.push({
        db: storage.tasks.assignment(session.id).taskIds,
        memory: session.turnTaskContext?.taskIds
      })
    }
  })
  const result = storage.tasks.activate(request, actor)
  assert.deepEqual(seen, [{ db: [request.taskId], memory: [request.taskId] }])
  assert.throws(
    () =>
      storage.tasks.activate({ ...request, requestId: randomUUID() }, actor),
    /assignment changed/
  )
  assert.equal(
    storage.tasks.assignment(session.id).version,
    result.assignment.version
  )
})
