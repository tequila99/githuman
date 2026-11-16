import { buildSessionHandoffContext } from '../../../src/server/services/agent/session-handoff-context-builder.ts'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import type {
  JournalEntry,
  JournalContext
} from '../../../src/shared/task-journal/types.ts'
import { MAX_JOURNAL_PAGE_BYTES } from '../../../src/shared/task-journal/constants.ts'

// User transport identity for journal writes in these tests.
const USER = { kind: 'user' as const, id: 'local' }
// Distinct response snapshots detect accidental reuse of a chat's latest model.
const CONTEXT: JournalContext = {
  presetId: 'codex',
  agentName: 'Codex',
  sessionName: 'Original chat',
  model: 'sol',
  reasoning: 'low',
  settings: [],
  prompt: 'Original request',
  response: 'Original response',
  promptTruncated: false,
  responseTruncated: false
}

async function setup(t: TestContext) {
  const repo = await createTempGitRepo()
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: repo.dir,
    prefix: 'ght-'
  })
  t.after(() => {
    db.close()
    repo.cleanup()
  })
  const create = (title: string) =>
    storage.tasks.create(randomUUID(), { title, state: 'open' }, USER)
  const a = create('Alpha'),
    b = create('Beta')
  const append = (
    taskId: string,
    body: string,
    kind: 'note' | 'decision' = 'note'
  ) =>
    storage.journal.append(
      taskId,
      { requestId: randomUUID(), body, kind },
      USER
    )
  return { db, storage, a, b, append }
}
test('project journal searches all tasks before pagination and pins its snapshot', async t => {
  const { storage, a, b, append } = await setup(t)
  const old = append(a.id, 'Old needle')
  for (let i = 0; i < 35; i++) append(b.id, 'Unrelated ' + i)
  const latest = append(b.id, 'New needle', 'decision')
  const first = storage.journal.search({ query: 'needle', limit: 1 })
  assert.equal(first.items[0]?.id, latest.id)
  assert.equal(first.items[0]?.taskTitle, 'Beta')
  assert.notEqual(first.nextBeforeSeq, null)
  append(a.id, 'Later needle')
  const second = storage.journal.search({
    storeId: first.storeId,
    query: 'needle',
    limit: 1,
    throughSeq: first.throughSeq,
    beforeSeq: first.nextBeforeSeq!
  })
  assert.deepEqual(
    second.items.map(row => row.id),
    [old.id]
  )
  assert.equal(second.nextBeforeSeq, null)
  assert.equal(
    storage.journal.search({ query: 'needle', taskId: b.id, kind: 'note' })
      .items.length,
    0
  )
  assert.equal(
    storage.journal.search({
      query: 'needle',
      taskId: b.id,
      kind: 'decision',
      author: 'user'
    }).items[0]?.id,
    latest.id
  )
  assert.throws(() => storage.journal.search({ storeId: 'other' }), /store/i)
  assert.throws(() => storage.journal.search({ beforeSeq: 5 }), /store/i)
  assert.throws(() => storage.journal.search({ throughSeq: 5 }), /store/i)
  assert.equal(
    storage.journal.search({ storeId: first.storeId, throughSeq: 0 }).items
      .length,
    0
  )
})
test('search handles literal punctuation, Unicode and closed tasks', async t => {
  const { storage, a, append } = await setup(t)
  const entry = append(a.id, "ЁЖИК cafe\u0301 100%_ 'quote' \\ 🦔")
  for (const query of ['ежик', 'ёжик', 'CAFÉ', "100%_ 'quote' \\", '🦔']) {
    assert.equal(
      storage.journal.search({ query }).items[0]?.id,
      entry.id,
      query
    )
  }
  assert.equal(
    storage.journal.search({ query: '100%anything' }).items.length,
    0
  )
  storage.tasks.update(
    a.id,
    randomUUID(),
    a.version,
    { title: a.title, state: 'closed' },
    USER
  )
  assert.equal(storage.journal.search({ taskId: a.id }).items[0]?.id, entry.id)
  assert.throws(() => storage.journal.search({ query: '\0' }), /invalid/i)
})
test('correction state follows the snapshot even outside the query and page', async t => {
  const { storage, a, append } = await setup(t)
  const old = append(a.id, 'original text')
  const before = storage.journal.search({ query: 'original' })
  storage.journal.append(
    a.id,
    {
      requestId: randomUUID(),
      kind: 'decision',
      body: 'replacement',
      supersedesEntryId: old.id
    },
    USER
  )
  assert.equal(
    storage.journal.search({ query: 'original' }).items[0]?.isSuperseded,
    true
  )
  assert.equal(
    storage.journal.search({
      storeId: before.storeId,
      throughSeq: before.throughSeq,
      query: 'original'
    }).items[0]?.isSuperseded,
    false
  )
})
test('date filters canonicalize offsets and reject invalid or reversed bounds', async t => {
  const { storage, a } = await setup(t)
  const base: JournalEntry = {
    id: randomUUID(),
    seq: 0,
    storeId: storage.storeId,
    taskId: a.id,
    kind: 'note',
    body: 'Dated',
    eventType: null,
    actor: USER,
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: '2026-11-12T12:00:00.000Z'
  }
  storage.journal.repository.append(base)
  assert.equal(
    storage.journal.search({
      createdFrom: '2026-11-12T15:00:00+03:00',
      createdTo: '2026-11-12T07:00:00-05:00'
    }).items.length,
    1
  )
  assert.equal(
    storage.journal.search({ createdFrom: '2026-11-12T12:00:00.001Z' }).items
      .length,
    0
  )
  for (const createdFrom of [
    'garbage',
    '2026-02-30T00:00:00Z',
    '2026-11-12',
    '2026-11-12T25:00:00Z'
  ]) {
    assert.throws(() => storage.journal.search({ createdFrom }), /time/i)
  }
  assert.throws(
    () =>
      storage.journal.search({
        createdFrom: '2026-11-13T00:00:00Z',
        createdTo: '2026-11-12T00:00:00Z'
      }),
    /range/i
  )
})
test('legacy system actors match their displayed author and stores stay isolated', async t => {
  const { storage, db, a, append } = await setup(t)
  const ordinary = append(a.id, 'User note')
  const legacy = {
    ...ordinary,
    id: randomUUID(),
    kind: 'system',
    body: 'turn_finished',
    actor: { kind: 'user', id: 'server' }
  } as Record<string, unknown>
  delete legacy.eventType
  db.prepare(
    'INSERT INTO task_journal_entries(store_id,task_id,id,snapshot_json) VALUES(?,?,?,?)'
  ).run(storage.storeId, a.id, legacy.id as string, JSON.stringify(legacy))
  const foreign = { ...ordinary, id: randomUUID(), storeId: 'foreign' }
  db.prepare(
    'INSERT INTO task_journal_entries(store_id,task_id,id,snapshot_json) VALUES(?,?,?,?)'
  ).run('foreign', a.id, foreign.id, JSON.stringify(foreign))
  const system = storage.journal.search({ author: 'system' })
  assert.equal(system.items.length, 1)
  assert.deepEqual(system.items[0]?.actor, { kind: 'system', id: 'server' })
  assert.equal(system.items[0]?.eventType, 'turn_finished')
  assert.deepEqual(
    storage.journal.search({ author: 'user' }).items.map(row => row.id),
    [ordinary.id]
  )
  assert.equal(storage.journal.search({}).items.length, 2)
})
test('large journal pages are bounded and can all be read without gaps', async t => {
  const { storage, a, append } = await setup(t)
  for (let i = 0; i < 20; i++) append(a.id, 'я'.repeat(4096))
  let page = storage.journal.search({ limit: 50 })
  const all = [...page.items]
  assert.ok(
    Buffer.byteLength(JSON.stringify(page.items)) <= MAX_JOURNAL_PAGE_BYTES
  )
  while (page.nextBeforeSeq !== null) {
    page = storage.journal.search({
      limit: 50,
      storeId: page.storeId,
      throughSeq: page.throughSeq,
      beforeSeq: page.nextBeforeSeq
    })
    assert.ok(
      Buffer.byteLength(JSON.stringify(page.items)) <= MAX_JOURNAL_PAGE_BYTES
    )
    all.push(...page.items)
  }
  assert.equal(all.length, 20)
  assert.equal(new Set(all.map(row => row.id)).size, 20)
})

test('trajectory persists immediately, preserves order and survives without task assignment', async t => {
  const { storage, a } = await setup(t)
  const turn = {
    sessionId: 'chat-trajectory',
    turnId: 'turn-trajectory',
    assignmentVersion: 0,
    taskIds: [] as string[]
  }
  storage.journal.recordEvent(turn, 1, {
    type: 'tool_input',
    toolCallId: 'python',
    input: { command: 'python3', token: 'hidden' }
  })
  storage.journal.recordEvent(turn, 2, {
    type: 'tool',
    toolCallId: 'python',
    status: 'failed',
    output: 'sandbox failed'
  })
  storage.journal.recordEvent(turn, 2, {
    type: 'tool',
    toolCallId: 'python',
    status: 'failed',
    output: 'sandbox failed'
  })
  const rows = storage.journal.search({}).items
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.eventType, 'agent_event')
  assert.equal(rows[0]?.taskId, null)
  assert.equal(rows[0]?.sessionId, turn.sessionId)
  assert.equal(rows[0]?.turnId, turn.turnId)
  assert.match(rows[0].body, /sandbox failed/)
  assert.doesNotMatch(rows[1].body, /hidden/)
  assert.equal(
    storage.journal.search({ query: 'sandbox failed' }).items.length,
    1
  )
  storage.journal.recordEvent({ ...turn, taskIds: [a.id] }, 3, {
    type: 'message',
    role: 'thought',
    text: 'Try another approach'
  })
  assert.equal(
    storage.journal.list(a.id, { storeId: storage.storeId }).items.length,
    1
  )
})

test('agent and model filters apply before pagination and options cover the whole task', async t => {
  const { storage, a, b, append } = await setup(t)
  const base = append(a.id, 'Without context')
  const add = (taskId: string, agentName: string, model: string) =>
    storage.journal.repository.append({
      ...base,
      id: randomUUID(),
      taskId,
      context: {
        presetId: agentName,
        agentName,
        model,
        sessionName: '',
        reasoning: null,
        settings: [],
        prompt: '',
        response: '',
        promptTruncated: false,
        responseTruncated: false
      }
    })
  const first = add(a.id, 'Codex', 'model-a')
  add(a.id, 'Claude', 'model-b')
  add(b.id, 'Other', 'model-c')
  const page = storage.journal.search({
    taskId: a.id,
    agentName: 'Codex',
    model: 'model-a',
    limit: 1
  })
  assert.deepEqual(
    page.items.map(row => row.id),
    [first.id]
  )
  assert.deepEqual(page.agentNames, ['Claude', 'Codex'])
  assert.deepEqual(page.models, ['model-a', 'model-b'])
  assert.equal(
    storage.journal.search({ agentName: 'Codex', model: 'model-b' }).items
      .length,
    0
  )
  assert.equal(storage.journal.search({ agentName: 'Code' }).items.length, 0)
})

test('event provenance persists immediately and participates in search and filters', async t => {
  const { storage, a } = await setup(t)
  const turn = {
    sessionId: 'chat',
    turnId: 'first',
    assignmentVersion: 0,
    taskIds: [a.id]
  }
  const {
    prompt: _prompt,
    response: _response,
    promptTruncated: _promptTruncated,
    responseTruncated: _responseTruncated,
    ...provenance
  } = CONTEXT
  storage.journal.recordEvent(
    turn,
    1,
    { type: 'message', role: 'agent', text: 'hello' },
    undefined,
    provenance
  )
  provenance.model = 'changed'
  const page = storage.journal.search({ agentName: 'Codex', model: 'sol' })
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0]?.provenance?.model, 'sol')
  assert.equal(page.items[0]?.context, undefined)
  assert.equal(Object.hasOwn(page.items[0]?.provenance ?? {}, 'prompt'), false)
  assert.equal(storage.journal.search({ query: 'sol' }).items.length, 1)
  assert.deepEqual(page.models, ['sol'])
  assert.equal(
    storage.journal.list(a.id, { storeId: storage.storeId }).items[0]
      ?.provenance?.agentName,
    'Codex'
  )
})

test('legacy events recover only their response metadata without rewriting history', async t => {
  const { storage, a, db } = await setup(t)
  const turn = {
    sessionId: 'chat',
    turnId: 'first',
    assignmentVersion: 0,
    taskIds: [a.id]
  }
  storage.journal.recordEvent(turn, 1, {
    type: 'message',
    role: 'agent',
    text: 'old message'
  })
  const before = storage.journal.search({})
  const old = before.items[0]
  assert.ok(old)
  storage.journal.recordTurn({ ...turn, turnId: 'other' }, 'finished', {
    ...CONTEXT,
    model: 'other-model'
  })
  storage.journal.recordTurn(turn, 'finished', CONTEXT)
  const page = storage.journal.search({ model: 'sol' })
  const recovered = page.items.find(row => row.id === old.id)!
  assert.equal(recovered.provenance?.agentName, 'Codex')
  assert.equal(recovered.provenance?.model, 'sol')
  assert.equal(recovered.context, undefined)
  assert.equal(Object.hasOwn(recovered.provenance ?? {}, 'response'), false)
  assert.equal(
    storage.journal.repository.entry(old.id)?.provenance?.model,
    'sol'
  )
  assert.equal(
    storage.journal
      .list(a.id, { storeId: storage.storeId })
      .items.find(row => row.id === old.id)?.provenance?.model,
    'sol'
  )
  assert.equal(
    storage.journal.search({
      storeId: before.storeId,
      throughSeq: before.throughSeq
    }).items[0]?.provenance,
    undefined
  )
  const raw = db
    .prepare('SELECT snapshot_json FROM task_journal_entries WHERE id=?')
    .get(old.id)!
  assert.equal(JSON.parse(String(raw.snapshot_json)).provenance, undefined)
  assert.equal(
    storage.journal
      .search({ model: 'other-model' })
      .items.some(row => row.id === old.id),
    false
  )
})

test('session journal isolates exact sessions, deduplicates task copies and pins pagination', async t => {
  const { storage, a, b } = await setup(t)
  for (let i = 0; i < 5; i++) {
    for (const taskId of [a.id, b.id]) {
      storage.journal.fact(
        taskId,
        `session-event-${i}`,
        'agent_event',
        JSON.stringify({ type: 'request', text: 'Request ' + i }),
        { sessionId: 'source', turnId: 'turn-' + i }
      )
    }
  }
  storage.journal.fact(null, 'other-event', 'agent_event', 'Foreign', {
    sessionId: 'source-other'
  })
  const first = storage.journal.session({
    storeId: storage.storeId,
    sessionId: 'source',
    limit: 2
  })
  storage.journal.fact(null, 'later-event', 'agent_event', 'Later', {
    sessionId: 'source'
  })
  const rows = [...first.items]
  let before = first.nextBeforeSeq
  while (before !== null) {
    const page = storage.journal.session({
      storeId: storage.storeId,
      sessionId: 'source',
      throughSeq: first.throughSeq,
      beforeSeq: before,
      limit: 2
    })
    rows.push(...page.items)
    before = page.nextBeforeSeq
  }
  assert.equal(rows.length, 5)
  assert.equal(new Set(rows.map(row => row.body)).size, 5)
  assert.ok(rows.every(row => row.sessionId === 'source'))
  assert.equal(
    storage.journal.search({ sessionId: 'source-other' }).items.length,
    1
  )
  assert.throws(
    () => storage.journal.session({ storeId: 'wrong', sessionId: 'source' }),
    /store/i
  )
})

test('session snapshot bounds UTF-8 context and keeps the original and latest requests', async t => {
  const { storage } = await setup(t)
  storage.journal.fact(
    null,
    'first',
    'turn_finished',
    'turn_finished',
    { sessionId: 'large' },
    { ...CONTEXT, prompt: 'Original objective', response: 'old result' }
  )
  for (let i = 0; i < 120; i++) {
    storage.journal.fact(
      null,
      `large-${i}`,
      'agent_event',
      JSON.stringify({ type: 'message', text: 'я'.repeat(3500), index: i }),
      { sessionId: 'large' }
    )
  }
  storage.journal.fact(
    null,
    'last',
    'turn_failed',
    'turn_failed',
    { sessionId: 'large' },
    { ...CONTEXT, prompt: 'Latest correction', response: 'я'.repeat(32000) }
  )
  const snapshot = buildSessionHandoffContext(storage, 'large')
  assert.ok(Buffer.byteLength(snapshot.snapshot) < 64 * 1024)
  assert.match(snapshot.snapshot, /Original objective/)
  assert.match(snapshot.snapshot, /Latest correction/)
  assert.match(snapshot.snapshot, /turn_failed/)
  assert.match(snapshot.snapshot, /Older or oversized entries were omitted/)
  assert.match(snapshot.snapshot, /sessions.journal_list/)
  assert.ok(!snapshot.snapshot.includes('�'))
})
