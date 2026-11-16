import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { createSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'
import { TaskHandoffService } from '../../../src/server/services/task-handoff.service.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'

// The fixture provides a real ACP lifecycle without calling an external model.
const PRESET = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')],
  autoApprovesEdits: false
}
// User identity is assigned by the HTTP access layer in production.
const USER = { kind: 'user' as const, id: 'local' }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'agent timeout')
    await delay(10)
  }
}
async function setup(
  t: TestContext,
  options: {
    bufferLimit?: number
    thoughtLevel?: string
    captureEvents?: boolean
  } = {}
) {
  const fixture = await createTempGitRepo()
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: fixture.dir,
    prefix: 'ght-'
  })
  const registry = createSessionRegistry({
    presets: [
      { ...PRESET, env: { FAKE_THOUGHT_LEVEL: options.thoughtLevel ?? '' } },
      { ...PRESET, id: 'bad', command: '/nonexistent-githuman-agent' }
    ],
    repositoryPath: fixture.dir,
    bufferLimit: options.bufferLimit,
    taskIds: id => storage.definitions.assignment(id).taskIds,
    taskAssignment: id => storage.definitions.assignment(id),
    onJournalEvent: (turn, eventId, event, redact, provenance) =>
      options.captureEvents &&
      storage.journal.recordEvent(turn, eventId, event, redact, provenance),
    onTurnComplete: (turn, outcome, context) =>
      storage.journal.recordTurn(turn, outcome, context)
  })
  storage.tasks.attachSessions(registry)
  storage.journal.attachSessions(registry)
  const handoffs = new TaskHandoffService(
    storage,
    registry,
    fixture.dir,
    () => true
  )
  const task = storage.tasks.create(
    randomUUID(),
    { title: 'Journal task', state: 'open' },
    USER
  )
  t.after(async () => {
    await handoffs.close()
    registry.closeAll()
    await delay(30)
    db.close()
    fixture.cleanup()
  })
  async function chat(taskId = task.id) {
    const source = registry.create('fake', null)
    await until(() => source.status === 'ready')
    storage.tasks.assignSession(
      source.id,
      { requestId: randomUUID(), expectedVersion: 0, taskIds: [taskId] },
      USER
    )
    return source
  }
  async function transfer(sourceSessionId?: string, presetId = 'fake') {
    const preview = await handoffs.preview(
      task.id,
      {
        requestId: randomUUID(),
        storeId: storage.storeId,
        presetId,
        ...(sourceSessionId
          ? {
              sourceSessionId,
              sourceAssignmentVersion:
                storage.definitions.assignment(sourceSessionId).version
            }
          : {})
      },
      USER
    )
    handoffs.confirm(preview.id, preview.digest, USER)
    await until(() =>
      ['ready', 'failed'].includes(handoffs.get(preview.id, USER).state)
    )
    return handoffs.get(preview.id, USER)
  }
  return { storage, registry, task, db, handoffs, chat, transfer }
}

test('journal is append-only, idempotent, paginated and independent from artifact epochs', async t => {
  const { storage, task, db } = await setup(t)
  const epoch = storage.catalog.epoch()
  const validation = storage.catalog.validationEpoch()
  const input = {
    requestId: randomUUID(),
    kind: 'decision' as const,
    body: 'Keep the context bounded.'
  }
  const first = storage.journal.append(task.id, input, USER)
  assert.deepEqual(storage.journal.append(task.id, input, USER), first)
  assert.throws(() =>
    storage.journal.append(task.id, { ...input, body: 'different' }, USER)
  )
  const page = storage.journal.list(task.id, {
    storeId: storage.storeId,
    limit: 1
  })
  const second = storage.journal.append(
    task.id,
    {
      requestId: randomUUID(),
      kind: 'next',
      body: 'Implement',
      supersedesEntryId: first.id
    },
    USER
  )
  assert.equal(
    storage.journal.list(task.id, {
      storeId: storage.storeId,
      throughSeq: page.throughSeq
    }).items.length,
    1
  )
  assert.equal(storage.journal.repository.isSuperseded(first.id), true)
  assert.throws(() =>
    storage.journal.append(
      task.id,
      {
        requestId: randomUUID(),
        kind: 'note',
        body: 'again',
        supersedesEntryId: first.id
      },
      USER
    )
  )
  assert.throws(() => storage.journal.list(task.id, { storeId: 'wrong-store' }))
  assert.throws(() =>
    storage.journal.append(
      task.id,
      { requestId: randomUUID(), kind: 'note', body: 'я'.repeat(5000) },
      USER
    )
  )
  assert.throws(() =>
    db.prepare('UPDATE task_journal_entries SET snapshot_json=?').run('{}')
  )
  assert.throws(() => db.prepare('DELETE FROM task_journal_entries').run())
  assert.throws(() =>
    db
      .prepare(
        'INSERT OR REPLACE INTO task_journal_entries(seq,store_id,task_id,id,snapshot_json) VALUES(?,?,?,?,?)'
      )
      .run(second.seq, storage.storeId, task.id, second.id, '{}')
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(storage.catalog.validationEpoch(), validation)
})

test('agent journal uses frozen response task after UI reassignment and rejects cancelled turns', async t => {
  const { storage, task, chat } = await setup(t)
  const source = await chat()
  source.prompt([{ type: 'text', text: 'slow' }], { text: 'slow' })
  const turn = source.turnTaskContext!
  storage.tasks.assignSession(
    source.id,
    { requestId: randomUUID(), expectedVersion: 1, taskIds: [] },
    USER
  )
  const actor = { kind: 'agent' as const, id: source.id }
  assert.equal(
    storage.journal.append(
      task.id,
      {
        requestId: randomUUID(),
        kind: 'next',
        body: 'Still belongs to the original response'
      },
      actor,
      turn.turnId
    ).taskId,
    task.id
  )
  await source.cancel()
  assert.throws(() =>
    storage.journal.append(
      task.id,
      { requestId: randomUUID(), kind: 'note', body: 'too late' },
      actor,
      turn.turnId
    )
  )
  await until(() => source.status === 'ready')
  assert.equal(
    storage.journal
      .list(task.id, { storeId: storage.storeId })
      .items.filter(entry => entry.kind === 'system')[0]?.body,
    'turn_cancelled'
  )
})

test('handoff is idempotent; source stays read-only until successor closes; initial context is sent once', async t => {
  const { storage, registry, task, handoffs, chat, transfer } = await setup(t)
  const source = await chat()
  const operation = await transfer(source.id)
  assert.equal(operation.state, 'ready')
  const target = registry.get(operation.targetSessionId!)!
  assert.deepEqual(storage.definitions.assignment(target.id).taskIds, [task.id])
  assert.equal(source.blockedBySessionId, target.id)
  assert.throws(() =>
    source.prompt([{ type: 'text', text: 'forbidden' }], { text: 'forbidden' })
  )
  assert.throws(() => source.setAutoApprove(true))
  await assert.rejects(source.setConfig('model', 'm2'))
  assert.throws(() =>
    storage.tasks.assignSession(
      source.id,
      { requestId: randomUUID(), expectedVersion: 1, taskIds: [] },
      USER
    )
  )
  assert.equal(
    handoffs.confirm(operation.id, operation.digest, USER).targetSessionId,
    target.id
  )
  assert.equal(registry.list().length, 2)
  assert.equal(target.info().hasInitialContext, true)
  target.prompt([{ type: 'text', text: 'echo:continue' }], {
    text: 'echo:continue'
  })
  assert.equal(target.info().hasInitialContext, false)
  await until(() => target.status === 'ready')
  const messages = target
    .replay(0)
    .envelopes.filter(e => e.event.type === 'message')
  assert.ok(
    messages.some(
      e =>
        e.event.type === 'message' &&
        e.event.text.includes('Task handoff snapshot')
    )
  )
  registry.close(target.id)
  assert.equal(source.blockedBySessionId, undefined)
  assert.doesNotThrow(() => source.assertCanPrompt())
})

test('handoff failure releases source and continuation works without a live source', async t => {
  const { registry, chat, transfer } = await setup(t)
  const source = await chat()
  const failed = await transfer(source.id, 'bad')
  assert.equal(failed.state, 'failed')
  assert.equal(source.blockedBySessionId, undefined)
  assert.doesNotThrow(() => source.assertCanPrompt())
  registry.close(source.id)
  const continued = await transfer()
  assert.equal(continued.state, 'ready')
  assert.equal(continued.sourceSessionId, null)
})

test('handoff chains release only the source of the closed successor', async t => {
  const { registry, chat, transfer } = await setup(t)
  const a = await chat()
  const b = registry.get((await transfer(a.id)).targetSessionId!)!
  const c = registry.get((await transfer(b.id)).targetSessionId!)!
  assert.equal(a.blockedBySessionId, b.id)
  assert.equal(b.blockedBySessionId, c.id)
  registry.close(c.id)
  assert.equal(b.blockedBySessionId, undefined)
  assert.equal(a.blockedBySessionId, b.id)
  registry.close(b.id)
  assert.equal(a.blockedBySessionId, undefined)
})

test('stale source selection and changed task are rejected before handoff side effects', async t => {
  const { storage, registry, task, handoffs, chat } = await setup(t)
  const source = await chat()
  const preview = await handoffs.preview(
    task.id,
    {
      requestId: randomUUID(),
      storeId: storage.storeId,
      presetId: 'fake',
      sourceSessionId: source.id,
      sourceAssignmentVersion: 1
    },
    USER
  )
  storage.tasks.assignSession(
    source.id,
    { requestId: randomUUID(), expectedVersion: 1, taskIds: [] },
    USER
  )
  assert.throws(() => handoffs.confirm(preview.id, preview.digest, USER))
  assert.equal(registry.list().length, 1)
})

test('handoff context cannot leak into a different or closed task before first prompt', async t => {
  const { storage, registry, task, transfer } = await setup(t)
  const operation = await transfer()
  const target = registry.get(operation.targetSessionId!)!
  const other = storage.tasks.create(
    randomUUID(),
    { title: 'Different', state: 'open' },
    USER
  )
  storage.tasks.assignSession(
    target.id,
    { requestId: randomUUID(), expectedVersion: 1, taskIds: [other.id] },
    USER
  )
  assert.throws(
    () =>
      target.prompt([{ type: 'text', text: 'continue' }], { text: 'continue' }),
    /handoff task or assignment changed/
  )
  registry.close(target.id)
  const second = registry.get((await transfer()).targetSessionId!)!
  storage.tasks.update(
    task.id,
    randomUUID(),
    task.version,
    { title: task.title, state: 'closed' },
    USER
  )
  assert.throws(
    () =>
      second.prompt([{ type: 'text', text: 'continue' }], { text: 'continue' }),
    /handoff task or assignment changed/
  )
})

test('two handoff services claim a preview only once and set the claiming owner', async t => {
  const { storage, registry, task, handoffs } = await setup(t)
  const preview = await handoffs.preview(
    task.id,
    { requestId: randomUUID(), storeId: storage.storeId, presetId: 'fake' },
    USER
  )
  storage.lifecycle.repository.beat(
    storage.lifecycle.jobs.ownerId,
    Date.now(),
    60_000
  )
  const competing = new TaskHandoffService(storage, registry, '.', () => true)
  handoffs.confirm(preview.id, preview.digest, USER)
  competing.confirm(preview.id, preview.digest, USER)
  await until(() => handoffs.get(preview.id, USER).state === 'ready')
  assert.equal(registry.list().length, 1)
})

test('an interrupted handoff cannot become ready when its owner resumes', async t => {
  const { storage, registry, task, handoffs, chat } = await setup(t)
  const source = await chat()
  const preview = await handoffs.preview(
    task.id,
    {
      requestId: randomUUID(),
      storeId: storage.storeId,
      presetId: 'fake',
      sourceSessionId: source.id,
      sourceAssignmentVersion: 1
    },
    USER
  )
  handoffs.confirm(preview.id, preview.digest, USER)
  const interrupted = storage.journal.repository.handoff(preview.id)!
  interrupted.state = 'interrupted'
  interrupted.error = 'owner interrupted'
  storage.journal.repository.updateHandoff(interrupted)
  await until(() => registry.list().length === 1 && !source.info().reserved)
  assert.equal(handoffs.get(preview.id, USER).state, 'interrupted')
  assert.equal(source.blockedBySessionId, undefined)
})

test('failure to persist a terminal handoff is reported without unhandled rejection or a stuck source', async t => {
  const { storage, task, handoffs, chat } = await setup(t)
  const source = await chat()
  const reports: unknown[] = []
  handoffs.setErrorHandler(error => reports.push(error))
  const repository = storage.journal.repository
  const update = repository.updateHandoff.bind(repository)
  t.mock.method(
    repository,
    'updateHandoff',
    (value: Parameters<typeof repository.updateHandoff>[0]) => {
      if (value.state === 'failed') throw new Error('disk unavailable')
      update(value)
    }
  )
  const preview = await handoffs.preview(
    task.id,
    {
      requestId: randomUUID(),
      storeId: storage.storeId,
      presetId: 'bad',
      sourceSessionId: source.id,
      sourceAssignmentVersion: 1
    },
    USER
  )
  handoffs.confirm(preview.id, preview.digest, USER)
  await until(() => reports.length === 1)
  assert.equal(source.info().reserved, false)
  assert.equal(source.blockedBySessionId, undefined)
  await handoffs.close()
})

test('server facts have a system author and an event type; legacy facts are upgraded on read', async t => {
  const { storage, task, db, chat } = await setup(t)
  const source = await chat()
  source.prompt([{ type: 'text', text: 'echo:x' }], { text: 'echo:x' })
  await until(() => source.status === 'ready')
  const [fact] = storage.journal
    .list(task.id, { storeId: storage.storeId })
    .items.filter(entry => entry.kind === 'system')
  assert.deepEqual(fact?.actor, { kind: 'system', id: 'server' })
  assert.equal(fact?.eventType, 'turn_finished')
  const legacy = {
    id: randomUUID(),
    seq: 0,
    storeId: storage.storeId,
    taskId: task.id,
    kind: 'system',
    body: 'handoff_completed: A → B',
    actor: { kind: 'user', id: 'server' },
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: new Date().toISOString()
  }
  db.prepare(
    'INSERT INTO task_journal_entries(store_id,task_id,id,snapshot_json) VALUES(?,?,?,?)'
  ).run(storage.storeId, task.id, legacy.id, JSON.stringify(legacy))
  const upgraded = storage.journal.repository.entry(legacy.id)!
  assert.equal(upgraded.eventType, 'handoff_completed')
  assert.deepEqual(upgraded.actor, { kind: 'system', id: 'server' })
  const user = storage.journal.append(
    task.id,
    { requestId: randomUUID(), kind: 'note', body: 'mine' },
    USER
  )
  assert.equal(user.eventType, null)
})

test('unassigned responses are project facts, idempotent and separate from task journals', async t => {
  const { storage, task } = await setup(t)
  const changed = t.mock.method(storage.journal, 'changed')
  const epoch = storage.catalog.epoch()
  const turn = {
    turnId: randomUUID(),
    sessionId: randomUUID(),
    assignmentVersion: 0,
    source: 'turn_assignment' as const,
    taskIds: []
  }
  storage.journal.recordTurn(turn, 'finished')
  storage.journal.recordTurn(turn, 'finished')
  const page = storage.journal.search({})
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].taskId, null)
  assert.equal(page.items[0].taskTitle, null)
  assert.equal(page.items[0].eventType, 'turn_finished')
  assert.equal(page.items[0].turnId, turn.turnId)
  assert.equal(storage.journal.search({ taskId: task.id }).items.length, 0)
  assert.equal(
    storage.journal.list(task.id, { storeId: storage.storeId }).items.length,
    0
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(changed.mock.callCount(), 2)
})

test('ordinary unassigned agents retain finished, cancelled and failed response context', async t => {
  const { storage, registry, task } = await setup(t)
  const source = registry.create('fake', null)
  await until(() => source.status === 'ready')
  source.prompt([{ type: 'text', text: 'echo:unassigned answer' }], {
    text: 'Question without a task'
  })
  await until(() => source.status === 'ready')
  const first = storage.journal.search({ query: 'Question without a task' })
    .items[0]
  assert.equal(first.taskId, null)
  assert.equal(first.eventType, 'turn_finished')
  assert.equal(first.context?.response, 'echo:echo:unassigned answer')
  assert.equal(first.context?.model, 'm1')
  assert.equal(first.sessionId, source.id)
  source.prompt([{ type: 'text', text: 'slow' }], { text: 'Cancel unassigned' })
  await until(() => Boolean(source.journalContext?.response))
  await source.cancel()
  await until(() => source.status === 'ready')
  const cancelled = storage.journal.search({ query: 'Cancel unassigned' })
    .items[0]
  assert.equal(cancelled.taskId, null)
  assert.equal(cancelled.eventType, 'turn_cancelled')
  assert.match(cancelled.context!.response, /tick/)
  source.prompt([{ type: 'text', text: 'crash' }], {
    text: 'Failed unassigned'
  })
  await until(
    () =>
      storage.journal.search({ query: 'Failed unassigned' }).items.length === 1
  )
  const failed = storage.journal.search({ query: 'Failed unassigned' }).items[0]
  assert.equal(failed.taskId, null)
  assert.equal(failed.eventType, 'turn_failed')
  assert.equal(failed.context?.response, 'about to crash')
  registry.close(source.id)
  assert.equal(storage.journal.search({}).items.length, 3)
  assert.equal(
    storage.journal.repository.entry(first.id)?.context?.prompt,
    'Question without a task'
  )
  assert.equal(storage.journal.search({ taskId: task.id }).items.length, 0)
})

test('artifact validators never write response events', async t => {
  const { storage, registry } = await setup(t)
  const source = registry.create(
    'fake',
    null,
    undefined,
    undefined,
    undefined,
    'validation'
  )
  await until(() => source.status === 'ready')
  source.prompt([{ type: 'text', text: 'echo:validation answer' }], {
    text: 'Validate'
  })
  await until(() => source.status === 'ready')
  assert.equal(storage.journal.search({}).items.length, 0)
})

test('handoff context packs whole entries in sequence order with visible omission counts', async t => {
  const { storage, task, handoffs } = await setup(t)
  const decision = storage.journal.append(
    task.id,
    { requestId: randomUUID(), kind: 'decision', body: 'Decision A' },
    USER
  )
  for (let index = 0; index < 40; index++) {
    storage.journal.append(
      task.id,
      {
        requestId: randomUUID(),
        kind: 'note',
        body: `note ${index} ` + 'я'.repeat(2000)
      },
      USER
    )
  }
  storage.journal.append(
    task.id,
    { requestId: randomUUID(), kind: 'next', body: 'Old next' },
    USER
  )
  storage.journal.append(
    task.id,
    { requestId: randomUUID(), kind: 'next', body: 'Newest next' },
    USER
  )
  const preview = await handoffs.preview(
    task.id,
    { requestId: randomUUID(), storeId: storage.storeId, presetId: 'fake' },
    USER
  )
  const snapshot = preview.snapshot
  assert.ok(Buffer.byteLength(snapshot) <= 64 * 1024)
  assert.match(snapshot, /Latest next step: Newest next/)
  assert.doesNotMatch(snapshot, /Old next/)
  assert.match(snapshot, /Shown \d+ of 43 entries .*omitted \d+/)
  assert.ok(snapshot.includes('## How to continue'))
  const journal = snapshot
    .slice(snapshot.indexOf('## Journal'), snapshot.indexOf('## Linked'))
    .split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as { seq: number; id: string })
  assert.ok(journal.length > 1)
  assert.deepEqual(
    journal.map(entry => entry.seq),
    journal.map(entry => entry.seq).sort((a, b) => a - b)
  )
  assert.ok(journal.some(entry => entry.id === decision.id))
})

test('a full slot list rejects confirmation before reserving the source', async t => {
  const { storage, registry, task, handoffs, chat } = await setup(t)
  const source = await chat()
  const preview = await handoffs.preview(
    task.id,
    {
      requestId: randomUUID(),
      storeId: storage.storeId,
      presetId: 'fake',
      sourceSessionId: source.id,
      sourceAssignmentVersion: 1
    },
    USER
  )
  t.mock.method(registry, 'hasFreeSlot', () => false)
  assert.throws(
    () => handoffs.confirm(preview.id, preview.digest, USER),
    (error: Error & { code?: string }) =>
      error.code === 'GHT_AGENT_SESSION_LIMIT'
  )
  assert.equal(source.info().reserved, false)
  assert.equal(handoffs.get(preview.id, USER).state, 'preview')
})

test('source authorizations are revoked only after a successful handoff', async t => {
  const { storage, chat, transfer } = await setup(t)
  const revoke = t.mock.method(
    storage.lifecycle.authorization,
    'revokeSession',
    () => {}
  )
  const source = await chat()
  assert.equal((await transfer(source.id, 'bad')).state, 'failed')
  assert.equal(revoke.mock.callCount(), 0)
  assert.equal((await transfer(source.id)).state, 'ready')
  assert.deepEqual(revoke.mock.calls[0]?.arguments, [source.id])
})

test('maintenance persists interruptions of dead owners and purges old receipts', async t => {
  const { storage, task, handoffs } = await setup(t)
  const preview = await handoffs.preview(
    task.id,
    { requestId: randomUUID(), storeId: storage.storeId, presetId: 'fake' },
    USER
  )
  const stored = storage.journal.repository.handoff(preview.id)!
  storage.journal.repository.updateHandoff({ ...stored, state: 'preparing' })
  assert.equal(handoffs.get(preview.id, USER).state, 'interrupted')
  // Reading reports the interruption without writing it.
  assert.equal(
    storage.journal.repository.handoff(preview.id)!.state,
    'preparing'
  )
  handoffs.maintain()
  assert.equal(
    storage.journal.repository.handoff(preview.id)!.state,
    'interrupted'
  )
  handoffs.maintain(stored.expiresAt + 8 * 24 * 60 * 60 * 1000)
  assert.equal(storage.journal.repository.handoff(preview.id), undefined)
})

test('journal retains request, response and original agent settings after the chat closes', async t => {
  const { storage, task, registry, chat } = await setup(t)
  const source = await chat()
  source.prompt([{ type: 'text', text: 'settings' }], {
    text: 'Why this decision?',
    context: [{ kind: 'file', path: 'decision.ts' }]
  })
  await until(() => source.status === 'ready')
  const first = storage.journal.list(task.id, { storeId: storage.storeId })
    .items[0]
  assert.equal(first.context?.prompt, 'Why this decision?')
  assert.equal(first.context?.response, 'model:m1 fast:false')
  assert.equal(first.context?.presetId, 'fake')
  assert.equal(first.context?.agentName, 'Fake')
  assert.equal(first.context?.model, 'm1')
  assert.equal(first.context?.reasoning, null)
  assert.equal(first.sessionId, source.id)
  assert.ok(first.turnId)
  assert.match(first.context.references![0], /decision.ts/)
  await source.setConfig('model', 'm2')
  assert.equal(storage.journal.repository.entry(first.id)?.context?.model, 'm1')
  registry.close(source.id)
  assert.deepEqual(storage.journal.repository.entry(first.id), first)
  for (const query of ['Why this decision?', 'model:m1', 'Fake', source.id]) {
    assert.equal(
      storage.journal.search({ query }).items[0]?.id,
      first.id,
      query
    )
  }
})

test('agent semantic entries capture provenance at append time and cancellation retains partial output', async t => {
  const { storage, task, chat } = await setup(t)
  const source = await chat()
  source.prompt([{ type: 'text', text: 'slow' }], {
    text: 'Investigate tradeoffs'
  })
  await until(() => Boolean(source.journalContext?.response))
  const decision = storage.journal.append(
    task.id,
    {
      requestId: randomUUID(),
      kind: 'decision',
      body: 'Keep the current design'
    },
    { kind: 'agent', id: source.id },
    source.turnTaskContext!.turnId
  )
  assert.equal(decision.context?.model, 'm1')
  assert.equal(decision.context?.prompt, 'Investigate tradeoffs')
  assert.match(decision.context.response, /tick/)
  await source.cancel()
  await until(() => source.status === 'ready')
  const fact = storage.journal.list(task.id, { storeId: storage.storeId })
    .items[0]
  assert.equal(fact.eventType, 'turn_cancelled')
  assert.match(fact.context!.response, /tick/)
  assert.equal(source.journalContext, undefined)
  assert.deepEqual(storage.journal.repository.entry(decision.id), decision)
})

test('capture marks UTF-8 truncation and failed responses retain their last visible text', async t => {
  const { storage, task, chat } = await setup(t)
  const source = await chat()
  const text = 'я'.repeat(40_000)
  source.prompt([{ type: 'text', text }], { text })
  await until(() => source.status === 'ready')
  const large = storage.journal.list(task.id, { storeId: storage.storeId })
    .items[0]
  assert.equal(Buffer.byteLength(large.context!.prompt), 64 * 1024)
  assert.equal(large.context!.promptTruncated, true)
  assert.equal(large.context!.responseTruncated, true)
  assert.ok(!large.context!.response.includes('\uFFFD'))
  source.prompt([{ type: 'text', text: 'crash' }], { text: 'Explain failure' })
  await until(() => storage.journal.repository.newest(task.id) > large.seq)
  const failed = storage.journal.list(task.id, { storeId: storage.storeId })
    .items[0]
  assert.equal(failed.eventType, 'turn_failed')
  assert.equal(failed.context?.response, 'about to crash')
})

test('capture survives event buffer eviction and retains reported reasoning level', async t => {
  const { storage, task, chat } = await setup(t, {
    bufferLimit: 1,
    thoughtLevel: 'high'
  })
  const source = await chat()
  source.prompt([{ type: 'text', text: 'settings' }], {
    text: 'Remember this request'
  })
  await until(() => source.status === 'ready')
  assert.equal(source.replay(0).envelopes.length, 1)
  const fact = storage.journal.list(task.id, { storeId: storage.storeId })
    .items[0]
  assert.equal(fact.context?.reasoning, 'high')
  assert.equal(fact.context?.prompt, 'Remember this request')
  assert.equal(fact.context?.response, 'model:m1 fast:false')
})

test('session handoff works without a task, starts once in English and preserves the requests', async t => {
  const { storage, registry, handoffs } = await setup(t, {
    captureEvents: true
  })
  const source = registry.create('fake', null)
  await until(() => source.status === 'ready')
  const send = async (text: string) => {
    source.prompt([{ type: 'text', text }], { text })
    await until(() => source.status === 'ready')
  }
  await send('echo:Original goal')
  await send('echo:Latest correction')
  const input = {
    requestId: randomUUID(),
    storeId: storage.storeId,
    sourceSessionId: source.id,
    sourceAssignmentVersion: 0,
    presetId: 'fake',
    name: 'Successor'
  }
  const preview = await handoffs.previewSession(input, USER)
  assert.equal(preview.taskId, null)
  assert.match(preview.snapshot, /Original goal/)
  assert.match(preview.snapshot, /Latest correction/)
  assert.match(preview.snapshot, /sessions.journal_list/)
  assert.match(preview.snapshot, new RegExp(source.id))
  assert.ok(Buffer.byteLength(preview.snapshot) < 64 * 1024)
  assert.equal((await handoffs.previewSession(input, USER)).id, preview.id)
  handoffs.confirm(preview.id, preview.digest, USER)
  await until(() => handoffs.get(preview.id, USER).state !== 'preparing')
  const result = handoffs.get(preview.id, USER)
  assert.equal(result.state, 'ready', result.error ?? '')
  const target = registry.get(result.targetSessionId!)!
  await until(() => target.status === 'ready')
  assert.equal(target.name, 'Successor')
  assert.equal(target.info().hasInitialContext, false)
  assert.deepEqual(storage.definitions.assignment(target.id).taskIds, [])
  const requests = () =>
    storage.journal
      .session({ storeId: storage.storeId, sessionId: target.id, limit: 50 })
      .items.filter(
        row =>
          row.eventType === 'agent_event' &&
          JSON.parse(row.body).type === 'request'
      )
  assert.equal(requests().length, 1)
  assert.match(requests()[0].body, /Briefly summarize/)
  assert.match(requests()[0].body, new RegExp(source.id))
  assert.equal(source.blockedBySessionId, target.id)
  handoffs.confirm(preview.id, preview.digest, USER)
  assert.equal(requests().length, 1)
  registry.close(target.id)
  assert.equal(source.blockedBySessionId, undefined)
})

test('session handoff inherits several tasks and rejects changed history or busy sources', async t => {
  const { storage, registry, handoffs, task, chat } = await setup(t)
  const source = await chat()
  const other = storage.tasks.create(
    randomUUID(),
    { title: 'Other task', state: 'open' },
    USER
  )
  storage.tasks.assignSession(
    source.id,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      taskIds: [task.id, other.id]
    },
    USER
  )
  const input = {
    requestId: randomUUID(),
    storeId: storage.storeId,
    sourceSessionId: source.id,
    sourceAssignmentVersion: 2,
    presetId: 'fake'
  }
  const stale = await handoffs.previewSession(input, USER)
  source.prompt([{ type: 'text', text: 'echo:More work' }], {
    text: 'echo:More work'
  })
  await assert.rejects(
    handoffs.previewSession({ ...input, requestId: randomUUID() }, USER),
    /available/i
  )
  await until(() => source.status === 'ready')
  assert.throws(
    () => handoffs.confirm(stale.id, stale.digest, USER),
    /changed/i
  )
  const preview = await handoffs.previewSession(
    { ...input, requestId: randomUUID() },
    USER
  )
  handoffs.confirm(preview.id, preview.digest, USER)
  await until(() => handoffs.get(preview.id, USER).state !== 'preparing')
  const result = handoffs.get(preview.id, USER)
  assert.equal(result.state, 'ready', result.error ?? '')
  assert.deepEqual(
    storage.definitions.assignment(result.targetSessionId!).taskIds,
    storage.definitions.assignment(source.id).taskIds
  )
  const rows = storage.journal.session({
    storeId: storage.storeId,
    sessionId: source.id,
    limit: 50
  }).items
  assert.equal(rows.filter(row => row.eventType === 'turn_finished').length, 1)
  registry.close(result.targetSessionId!)
})

test('session handoff failure releases source and a stopped process can be handed off', async t => {
  const { storage, registry, handoffs } = await setup(t)
  const source = registry.create('fake', null)
  await until(() => source.status === 'ready')
  const input = {
    requestId: randomUUID(),
    storeId: storage.storeId,
    sourceSessionId: source.id,
    sourceAssignmentVersion: 0,
    presetId: 'bad'
  }
  const failed = await handoffs.previewSession(input, USER)
  handoffs.confirm(failed.id, failed.digest, USER)
  await until(() => handoffs.get(failed.id, USER).state !== 'preparing')
  assert.equal(handoffs.get(failed.id, USER).state, 'failed')
  assert.equal(source.info().reserved, false)
  assert.equal(source.blockedBySessionId, undefined)
  source.close()
  assert.equal(source.status, 'closed')
  const preview = await handoffs.previewSession(
    { ...input, requestId: randomUUID(), presetId: 'fake' },
    USER
  )
  handoffs.confirm(preview.id, preview.digest, USER)
  await until(() => handoffs.get(preview.id, USER).state !== 'preparing')
  assert.equal(handoffs.get(preview.id, USER).state, 'ready')
})

test('a rejected automatic first prompt fails the handoff, releases source and is never retried', async t => {
  const { storage, registry, handoffs } = await setup(t)
  const source = registry.create('fake', null)
  await until(() => source.status === 'ready')
  const create = registry.create.bind(registry)
  let dispatches = 0
  t.mock.method(
    registry,
    'create',
    (...args: Parameters<typeof registry.create>) => {
      const target = create(...args)
      t.mock.method(target, 'prompt', () => {
        dispatches++
        throw new Error('First prompt was refused')
      })
      return target
    }
  )
  const preview = await handoffs.previewSession(
    {
      requestId: randomUUID(),
      storeId: storage.storeId,
      sourceSessionId: source.id,
      sourceAssignmentVersion: 0,
      presetId: 'fake'
    },
    USER
  )
  handoffs.confirm(preview.id, preview.digest, USER)
  await until(() => handoffs.get(preview.id, USER).state !== 'preparing')
  const result = handoffs.get(preview.id, USER)
  assert.equal(result.state, 'failed')
  assert.match(result.error!, /First prompt was refused/)
  assert.equal(source.blockedBySessionId, undefined)
  assert.equal(source.info().reserved, false)
  handoffs.confirm(preview.id, preview.digest, USER)
  assert.equal(dispatches, 1)
  assert.equal(registry.get(result.targetSessionId!), undefined)
})
