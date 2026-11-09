import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import type { AgentSessionInfo } from '../../../src/shared/agents/types.ts'

// The fixture performs actual MCP stdio calls through the authenticated HTTP bridge.
const PRESET = {
  id: 'probe',
  title: 'Task probe',
  command: process.execPath,
  args: [
    join(import.meta.dirname, '../fixtures/fake-acp-task-binding-agent.ts')
  ],
  autoApprovesEdits: false
}

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 20_000
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, 'probe timeout')
    await delay(20)
  }
}

test(
  'ACP → MCP inherits the accepted turn, isolates sessions and preserves replay and explicit overrides',
  { timeout: 60_000 },
  async t => {
    const root = mkdtempSync(join(tmpdir(), 'ght-turn-mcp-'))
    const db = createTestDatabase()
    const storage = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-'
    })
    const app = buildApp({
      repositoryPath: root,
      db,
      artifacts: storage,
      agentPresets: [PRESET]
    })
    t.after(async () => {
      await app.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    })
    const keys: string[] = []
    app.addHook('onRequest', async request => {
      if (
        request.url === '/api/agent/artifacts/artifacts.create' &&
        request.headers.authorization
      ) {
        keys.push(request.headers.authorization)
      }
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const actor = { kind: 'user' as const, id: 'local' }
    const a = storage.tasks.create(
      'task-a',
      { title: 'A', externalUrl: null, state: 'open' },
      actor
    ).id
    const b = storage.tasks.create(
      'task-b',
      { title: 'B', externalUrl: null, state: 'open' },
      actor
    ).id
    const info = async (id: string) =>
      (await app.inject(`/api/agent/sessions/${id}`)).json<AgentSessionInfo>()
    const createSession = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent/sessions',
        payload: { presetId: 'probe' }
      })
      assert.equal(res.statusCode, 201, res.body)
      const id = res.json<AgentSessionInfo>().id
      await until(async () => (await info(id)).status !== 'starting')
      assert.equal(
        (await info(id)).status,
        'ready',
        (await info(id)).error ?? ''
      )
      return id
    }
    const first = await createSession(),
      second = await createSession()
    assert.ok(
      storage
        .list()
        .items.filter(item => item.title === 'Idle')
        .every(item => item.taskIds.length === 0)
    )
    const assign = (id: string, taskIds: string[]) =>
      storage.tasks.assignSession(
        id,
        {
          requestId: `assign-${id}-${storage.tasks.assignment(id).version}`,
          expectedVersion: storage.tasks.assignment(id).version,
          taskIds
        },
        actor
      )
    assign(first, [a])
    assign(second, [b])
    const prompt = async (
      id: string,
      input: { requestId: string; hold?: boolean; taskIds?: string[] }
    ) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/agent/sessions/${id}/prompt`,
        payload: { text: JSON.stringify(input) }
      })
      assert.equal(res.statusCode, 202, res.body)
    }
    const artifact = (name: string) =>
      storage.list().items.find(item => item.title === name)
    await Promise.all([
      prompt(first, { requestId: 'first', hold: true }),
      prompt(second, { requestId: 'second' })
    ])
    await until(() => Boolean(artifact('first')) && Boolean(artifact('second')))
    assert.deepEqual(artifact('first')?.taskIds, [a])
    assert.deepEqual(artifact('second')?.taskIds, [b])
    assign(first, [b])
    const release = await app.inject({
      method: 'POST',
      url: `/api/agent/sessions/${first}/auto-approve`,
      payload: { enabled: true }
    })
    assert.equal(release.statusCode, 204)
    await until(
      async () =>
        (await info(first)).status === 'ready' &&
        (await info(second)).status === 'ready'
    )
    assert.deepEqual(artifact('first-after')?.taskIds, [a])
    const initialId = artifact('first')!.id
    await prompt(first, { requestId: 'first' })
    await until(async () => (await info(first)).status === 'ready')
    assert.equal(artifact('first')?.id, initialId)
    assert.deepEqual(artifact('first')?.taskIds, [a])
    for (const input of [
      { requestId: 'next' },
      { requestId: 'empty', taskIds: [] },
      { requestId: 'explicit', taskIds: [a] }
    ]) {
      await prompt(first, input)
      await until(async () => (await info(first)).status === 'ready')
      assert.ok(
        artifact(input.requestId),
        (await info(first)).error ?? input.requestId
      )
    }
    assert.deepEqual(artifact('next')?.taskIds, [b])
    assert.deepEqual(artifact('empty')?.taskIds, [])
    assert.deepEqual(artifact('explicit')?.taskIds, [a])
    for (const [name, ids] of [
      ['ambiguous', [a, b]],
      ['unassigned', []]
    ] as const) {
      assign(first, [...ids])
      await prompt(first, { requestId: name })
      await until(async () => (await info(first)).status === 'ready')
      assert.deepEqual(artifact(name)?.taskIds, [])
    }
    assert.equal(storage.tasks.get(a).state, 'open')
    assert.equal(storage.history(initialId).items.length, 1)
    assert.deepEqual((await info(first)).taskIds, [])
    assign(first, [b])
    const idle = await app.inject({
      method: 'POST',
      url: '/api/agent/artifacts/artifacts.create',
      headers: { authorization: keys[0] },
      payload: {
        requestId: 'assigned-idle',
        body: 'Idle',
        metadata: { title: 'Assigned idle', tags: [] }
      }
    })
    assert.equal(idle.statusCode, 200, idle.body)
    assert.deepEqual(idle.json<{ taskIds: string[] }>().taskIds, [])
  }
)
