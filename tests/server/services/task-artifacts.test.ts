import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { applyArtifactMigrations } from '../../../src/server/db/artifact-migrations.ts'
import { ARTIFACT_ERROR_CODES } from '../../../src/shared/artifacts/error-codes.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { buildPromptBlocks } from '../../../src/server/services/agent/context-builder.ts'

const ACTOR = { kind: 'user' as const, id: 'local' }

function fakeArtifact(
  id: string,
  exclusive: boolean,
  status: 'draft' | 'archived'
) {
  return {
    id,
    title: id,
    typeId: 'generic',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    exclusive
  }
}

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-task-artifacts-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  let counter = 0
  const task = (title: string) =>
    storage.tasks.create(`task-${++counter}`, { title, state: 'open' }, ACTOR)
  const artifact = (title: string, taskIds: string[]) =>
    storage.create(
      {
        requestId: `artifact-${++counter}`,
        body: `Body of ${title}`,
        metadata: { title, tags: [], taskIds }
      },
      ACTOR
    )
  return { root, db, storage, task, artifact }
}

test('task artifacts list every status and mark artifacts bound to one task', t => {
  const { storage, task, artifact } = setup(t)
  const first = task('First')
  const second = task('Second')
  const own = artifact('Own', [first.id])
  const shared = artifact('Shared', [first.id, second.id])
  artifact('Other', [second.id])
  const items = storage.tasks.artifacts(first.id).items
  assert.deepEqual(
    new Map(items.map(item => [item.id, item.exclusive])),
    new Map([
      [own.id, true],
      [shared.id, false]
    ])
  )
  assert.ok(items.every(item => item.status === 'draft'))
})

test('a task closes only after artifacts bound only to it are inactive', t => {
  const { storage, task } = setup(t)
  const current = task('Closing')
  // Archiving needs a validated change set; the test supplies statuses directly.
  let status: 'draft' | 'archived' = 'draft'
  storage.tasks.attachArtifacts(() => [
    fakeArtifact('own', true, status),
    fakeArtifact('shared', false, 'draft')
  ])
  const close = (requestId: string) =>
    storage.tasks.update(
      current.id,
      requestId,
      1,
      { title: 'Closing', state: 'closed' },
      ACTOR
    )
  assert.throws(() => close('close-1'), /Archive 1 artifact/)
  // Shared artifacts stay the user's choice and never block closing.
  status = 'archived'
  assert.equal(close('close-2').state, 'closed')
})

test('the task context lists title, description, links and artifacts without bodies', async t => {
  const { root, db, storage, task, artifact } = setup(t)
  const current = storage.tasks.create(
    'rich',
    {
      title: 'Rich task',
      state: 'open',
      description: 'DESCRIPTION_TEXT',
      links: [{ url: 'https://example.org/1', label: 'Issue' }]
    },
    ACTOR
  )
  void task
  const linked = artifact('Linked document', [current.id])
  const item = {
    kind: 'task' as const,
    storeId: storage.storeId,
    taskId: current.id,
    name: 'Ignored client name'
  }
  const deps = {
    db,
    artifacts: storage,
    repositoryPath: root,
    embeddedContext: true,
    image: false,
    attachmentDir: join(root, 'attachments')
  }
  const blocks = await buildPromptBlocks({ text: 'Go', context: [item] }, deps)
  const block = blocks[1]
  assert.equal(block.type, 'resource')
  if (block.type !== 'resource' || !('text' in block.resource)) return
  assert.equal(
    block.resource.uri,
    `githuman://task/${storage.storeId}/${current.id}`
  )
  const { text } = block.resource
  for (const expected of [
    'Rich task',
    'DESCRIPTION_TEXT',
    'Issue: https://example.org/1',
    'Linked document',
    linked.id
  ]) {
    assert.ok(text.includes(expected), expected)
  }
  assert.ok(!text.includes('Body of Linked document'))
  await assert.rejects(
    buildPromptBlocks(
      { text: 'Go', context: [{ ...item, storeId: 'another-store' }] },
      deps
    )
  )
})

test('a closed task takes no new artifacts, but existing bindings stay', t => {
  const { storage, task, artifact } = setup(t)
  const current = task('Closing')
  const sibling = task('Sibling')
  // A shared artifact does not block the close.
  const kept = artifact('Kept', [current.id, sibling.id])
  storage.tasks.update(
    current.id,
    'close',
    1,
    { title: 'Closing', state: 'closed' },
    ACTOR
  )
  assert.throws(
    () =>
      storage.create(
        {
          requestId: 'late',
          body: 'Late',
          metadata: { title: 'Late', tags: [], taskIds: [current.id] }
        },
        ACTOR
      ),
    { code: ARTIFACT_ERROR_CODES.taskClosed }
  )
  const other = artifact('Other', [])
  assert.throws(
    () =>
      storage.updateMetadata(
        other.id,
        {
          requestId: 'bind-late',
          expectedVersion: 1,
          metadata: { title: 'Other', tags: [], taskIds: [current.id] }
        },
        ACTOR
      ),
    { code: ARTIFACT_ERROR_CODES.taskClosed }
  )
  // An edit that leaves the closed binding in place is still allowed.
  const retitled = storage.updateMetadata(
    kept.id,
    {
      requestId: 'retitle',
      expectedVersion: 1,
      metadata: {
        title: 'Kept again',
        tags: [],
        taskIds: [current.id, sibling.id]
      }
    },
    ACTOR
  )
  assert.deepEqual(retitled.taskIds, [current.id, sibling.id])
})

test('conflicts of tasks carry distinct codes', t => {
  const { storage, task } = setup(t)
  const current = task('Codes')
  storage.tasks.attachArtifacts(() => [fakeArtifact('own', true, 'draft')])
  const update = (
    requestId: string,
    version: number,
    state: 'open' | 'closed'
  ) =>
    storage.tasks.update(
      current.id,
      requestId,
      version,
      { title: 'Codes', state },
      ACTOR
    )
  assert.throws(() => update('blocked', 1, 'closed'), {
    code: ARTIFACT_ERROR_CODES.taskHasActiveArtifacts
  })
  assert.throws(() => update('stale', 5, 'open'), {
    code: ARTIFACT_ERROR_CODES.versionConflict
  })
  storage.tasks.attachArtifacts(() => [])
  assert.equal(update('close', 1, 'closed').state, 'closed')
  assert.throws(() => update('again', 2, 'open'), {
    code: ARTIFACT_ERROR_CODES.taskClosed
  })
})

test('the task index follows rebinding and is rebuilt for databases that lack it', t => {
  const { db, storage, task, artifact } = setup(t)
  const first = task('First')
  const second = task('Second')
  const doc = artifact('Doc', [first.id])
  const ids = (taskId: string) =>
    storage.tasks.artifacts(taskId).items.map(item => item.id)
  assert.deepEqual(ids(first.id), [doc.id])
  storage.updateMetadata(
    doc.id,
    {
      requestId: 'move',
      expectedVersion: 1,
      metadata: { title: 'Doc', tags: [], taskIds: [second.id] }
    },
    ACTOR
  )
  assert.deepEqual(ids(first.id), [])
  assert.deepEqual(ids(second.id), [doc.id])
  // A database from before the index has artifacts and no links.
  db.exec(`
    DROP TRIGGER artifact_task_links_insert;
    DROP TRIGGER artifact_task_links_update;
    DROP TRIGGER artifact_task_links_delete;
    DROP TABLE artifact_task_links;
  `)
  applyArtifactMigrations(db)
  assert.deepEqual(ids(second.id), [doc.id])
  assert.deepEqual(ids(first.id), [])
})
