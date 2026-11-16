import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import type {
  Handoff,
  JournalPage
} from '../../../src/shared/task-journal/types.ts'

async function wait(get: () => Promise<boolean>) {
  const end = Date.now() + 15000
  while (!(await get())) {
    assert.ok(Date.now() < end, 'timed out')
    await delay(10)
  }
}

test('HTTP journal and handoff preserve schemas, source locking and recovery', async t => {
  const repo = await createTempGitRepo()
  const db = createTestDatabase()
  const app = buildApp({
    db,
    repositoryPath: repo.dir,
    agentPresets: [
      {
        id: 'fake',
        title: 'Fake',
        command: process.execPath,
        args: [join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')],
        autoApprovesEdits: false
      }
    ]
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(async () => {
    await app.close()
    db.close()
    repo.cleanup()
  })
  const headers = { 'content-type': 'application/json', origin: base }
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) })
  const taskResponse = await post('/api/tasks', {
    requestId: randomUUID(),
    input: { title: 'HTTP task', state: 'open' }
  })
  assert.equal(taskResponse.status, 200)
  const task = (await taskResponse.json()) as { id: string; storeId: string }
  const append = {
    requestId: randomUUID(),
    kind: 'next',
    body: 'Continue here',
    storeId: task.storeId
  }
  const added = await post(`/api/tasks/${task.id}/journal`, append)
  assert.equal(added.status, 200)
  const entry = (await added.json()) as {
    id: string
    actor: { kind: string; id: string }
  }
  assert.deepEqual(entry.actor, { kind: 'user', id: 'local' })
  assert.deepEqual(
    await (await post(`/api/tasks/${task.id}/journal`, append)).json(),
    entry
  )
  const page = (await (
    await fetch(`${base}/api/tasks/${task.id}/journal?storeId=${task.storeId}`)
  ).json()) as JournalPage
  assert.equal(page.items[0]?.id, entry.id)
  const wrongStore = await post(`/api/tasks/${task.id}/journal`, {
    ...append,
    requestId: randomUUID(),
    storeId: 'wrong'
  })
  assert.equal(wrongStore.status, 400)
  const previewResponse = await post(`/api/tasks/${task.id}/handoffs/preview`, {
    requestId: randomUUID(),
    storeId: task.storeId,
    presetId: 'fake'
  })
  assert.equal(previewResponse.status, 200)
  const preview = (await previewResponse.json()) as Handoff
  assert.equal(preview.state, 'preview')
  assert.ok(preview.snapshot.includes('Continue here'))
  assert.equal('input' in preview, false)
  const confirmed = await post(`/api/task-handoffs/${preview.id}/confirm`, {
    digest: preview.digest
  })
  assert.equal(confirmed.status, 200)
  let handoff = (await confirmed.json()) as Handoff
  const deadline = Date.now() + 10_000
  while (handoff.state === 'preparing') {
    assert.ok(Date.now() < deadline)
    await delay(20)
    handoff = (await (
      await fetch(`${base}/api/task-handoffs/${preview.id}`)
    ).json()) as Handoff
  }
  assert.equal(handoff.state, 'ready', handoff.error ?? '')
  const session = (await (
    await fetch(`${base}/api/agent/sessions/${handoff.targetSessionId}`)
  ).json()) as { taskIds: string[]; hasInitialContext: boolean }
  assert.deepEqual(session.taskIds, [task.id])
  assert.equal(session.hasInitialContext, true)
  const journal = (await (
    await fetch(`${base}/api/task-journal?taskId=${task.id}`)
  ).json()) as {
    items: JournalPage['items']
    agentNames: string[]
    models: string[]
  }
  assert.deepEqual(journal.agentNames, ['Fake'])
  assert.deepEqual(journal.models, ['m1'])
  const fact = journal.items.find(
    item => item.eventType === 'handoff_completed'
  )!
  assert.equal(fact.sessionId, handoff.targetSessionId)
  assert.equal(fact.context?.agentName, 'Fake')
  assert.equal(fact.context?.model, 'm1')
  assert.equal(fact.context?.reasoning, null)
  assert.equal(fact.context?.promptTruncated, false)
  assert.ok(
    fact.context?.settings.some(
      item => item.id === 'model' && item.value === 'm1'
    )
  )
  const taskJournal = (await (
    await fetch(`${base}/api/tasks/${task.id}/journal?storeId=${task.storeId}`)
  ).json()) as JournalPage
  assert.deepEqual(
    taskJournal.items.find(item => item.id === fact.id),
    Object.fromEntries(
      Object.entries(fact).filter(
        ([key]) => key !== 'taskTitle' && key !== 'isSuperseded'
      )
    )
  )

  const replay = (await (
    await post(`/api/task-handoffs/${preview.id}/confirm`, {
      digest: preview.digest
    })
  ).json()) as Handoff
  assert.equal(replay.targetSessionId, handoff.targetSessionId)

  const ordinary = await post('/api/agent/sessions', { presetId: 'fake' })
  assert.equal(ordinary.status, 201)
  const { id } = (await ordinary.json()) as { id: string }
  const readyDeadline = Date.now() + 10_000
  while (true) {
    const info = (await (
      await fetch(`${base}/api/agent/sessions/${id}`)
    ).json()) as { status: string }
    if (info.status === 'ready') break
    assert.ok(Date.now() < readyDeadline)
    await delay(20)
  }
  const prompt = await post(`/api/agent/sessions/${id}/prompt`, {
    text: 'echo:HTTP unassigned journal'
  })
  assert.equal(prompt.status, 202)
  const entryDeadline = Date.now() + 10_000
  let unassigned
  while (!unassigned) {
    const projectPage = (await (
      await fetch(`${base}/api/task-journal?query=HTTP%20unassigned%20journal`)
    ).json()) as { items: JournalPage['items'] }
    unassigned = projectPage.items.find(
      item => item.eventType === 'turn_finished'
    )
    assert.ok(Date.now() < entryDeadline)
    if (!unassigned) await delay(20)
  }
  assert.equal(unassigned.taskId, null)
  assert.equal(unassigned.eventType, 'turn_finished')
  assert.equal(unassigned.context?.prompt, 'echo:HTTP unassigned journal')
  assert.match(unassigned.context.response, /HTTP unassigned journal/)
  assert.equal(unassigned.context?.agentName, 'Fake')
  assert.equal(unassigned.context?.model, 'm1')
  assert.equal(unassigned.sessionId, id)
  assert.ok(unassigned.turnId)
})

test('HTTP project journal exposes a bounded filtered page and rejects invalid queries', async t => {
  const repo = await createTempGitRepo()
  const db = createTestDatabase()
  const app = buildApp({ db, repositoryPath: repo.dir })
  await app.ready()
  t.after(async () => {
    await app.close()
    db.close()
    repo.cleanup()
  })
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: randomUUID(),
      input: { title: 'Global journal', state: 'open' }
    }
  })
  assert.equal(created.statusCode, 200)
  const task = created.json<{ id: string; storeId: string }>()
  const added = await app.inject({
    method: 'POST',
    url: `/api/tasks/${task.id}/journal`,
    payload: {
      storeId: task.storeId,
      requestId: randomUUID(),
      body: 'Search across tasks',
      kind: 'decision'
    }
  })
  assert.equal(added.statusCode, 200)
  const found = await app.inject({
    url: '/api/task-journal?query=ACROSS&kind=decision&author=user&limit=1'
  })
  assert.equal(found.statusCode, 200)
  const page = found.json()
  assert.equal(page.storeId, task.storeId)
  assert.equal(page.items[0].taskTitle, 'Global journal')
  assert.equal(page.items[0].isSuperseded, false)
  assert.equal(page.items[0].body, 'Search across tasks')
  assert.equal(page.nextBeforeSeq, null)
  for (const query of [
    'storeId=wrong',
    'beforeSeq=2',
    'kind=invalid',
    'author=invalid',
    'limit=51',
    'limit=0',
    'createdFrom=bad',
    'createdFrom=2026-11-13T00:00:00Z&createdTo=2026-11-12T00:00:00Z'
  ]) {
    assert.equal(
      (await app.inject({ url: '/api/task-journal?' + query })).statusCode,
      400,
      query
    )
  }
})

test('HTTP session handoff accepts no task, preserves nullable schema and sends the first prompt', async t => {
  const repo = await createTempGitRepo()
  const db = createTestDatabase()
  const app = buildApp({
    db,
    repositoryPath: repo.dir,
    agentPresets: [
      {
        id: 'fake',
        title: 'Fake',
        command: process.execPath,
        args: [join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')],
        autoApprovesEdits: false
      }
    ]
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(async () => {
    await app.close()
    db.close()
    repo.cleanup()
  })
  const post = (path: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: path,
      headers: { origin: base, host: new URL(base).host },
      payload
    })
  const created = await post('/api/agent/sessions', { presetId: 'fake' })
  assert.equal(created.statusCode, 201, created.body)
  const source = created.json<{ id: string }>()
  await wait(
    async () =>
      (await app.inject(`/api/agent/sessions/${source.id}`)).json().status ===
      'ready'
  )
  assert.equal(
    (
      await post(`/api/agent/sessions/${source.id}/prompt`, {
        text: 'echo:Original HTTP goal'
      })
    ).statusCode,
    202
  )
  await wait(
    async () =>
      (await app.inject(`/api/agent/sessions/${source.id}`)).json().status ===
      'ready'
  )
  const storeId = (await app.inject('/api/tasks')).json().storeId as string
  const captured = await post('/api/session-handoffs/preview', {
    requestId: randomUUID(),
    storeId,
    presetId: 'fake',
    sourceSessionId: source.id,
    sourceAssignmentVersion: 0,
    name: 'HTTP successor'
  })
  assert.equal(captured.statusCode, 200, captured.body)
  const preview = captured.json<Handoff>()
  assert.equal(preview.taskId, null)
  assert.match(preview.snapshot, /Original HTTP goal/)
  const confirmed = await post(`/api/task-handoffs/${preview.id}/confirm`, {
    digest: preview.digest
  })
  assert.equal(confirmed.statusCode, 200, confirmed.body)
  await wait(
    async () =>
      (await app.inject(`/api/task-handoffs/${preview.id}`)).json().state !==
      'preparing'
  )
  const result = (
    await app.inject(`/api/task-handoffs/${preview.id}`)
  ).json<Handoff>()
  assert.equal(result.state, 'ready', result.error ?? '')
  await wait(
    async () =>
      (await app.inject(`/api/agent/sessions/${result.targetSessionId}`)).json()
        .status === 'ready'
  )
  const journal = await app.inject(
    `/api/session-journal?storeId=${storeId}&sessionId=${result.targetSessionId}`
  )
  assert.equal(journal.statusCode, 200, journal.body)
  assert.ok(
    journal
      .json()
      .items.some((row: { context?: { prompt: string } }) =>
        row.context?.prompt.includes('Briefly summarize')
      )
  )
})
