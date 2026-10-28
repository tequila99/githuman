import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

test(
  'ACP → stdio MCP → HTTP: assigned validator reads paginated context, cannot escape, then user commits',
  { timeout: 30000 },
  async t => {
    const root = mkdtempSync(join(tmpdir(), 'ght-validation-transport-'))
    const db = createTestDatabase()
    const storage = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-'
    })
    const app = buildApp({
      db,
      repositoryPath: root,
      artifacts: storage,
      agentPresets: [
        {
          id: 'validator',
          title: 'Validation test',
          command: process.execPath,
          args: [
            join(
              import.meta.dirname,
              '../fixtures/fake-acp-validation-agent.ts'
            )
          ],
          autoApprovesEdits: false
        }
      ]
    })
    t.after(async () => {
      await app.close()
      db.close()
      rmSync(root, { recursive: true, force: true })
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const user = { kind: 'user' as const, id: 'local' }
    const node = storage.create(
      {
        requestId: 'transport-create',
        body: 'Текст 🧪\n'.repeat(3000),
        metadata: { title: 'Transport', tags: [] }
      },
      user
    )
    storage.catalog.transaction(() =>
      storage.catalog.appendMetadata(
        { ...node, status: 'in_review', metadataVersion: 2 },
        'test-review',
        user,
        'metadata_updated'
      )
    )
    const proposal = await app.inject({
      method: 'POST',
      url: '/api/artifact-change-sets',
      payload: {
        requestId: 'proposal',
        changeSet: {
          storeId: storage.storeId,
          command: 'accept',
          subjectIds: [node.id],
          expectedVersions: [{ id: node.id, version: 2 }],
          relationChanges: [],
          targetStatuses: [{ artifactId: node.id, status: 'accepted' }],
          supplementDispositions: [],
          reason: 'Transport test'
        }
      }
    })
    assert.equal(proposal.statusCode, 200, proposal.body)
    const changeSetId = proposal.json().id
    const prepared = await app.inject({
      method: 'POST',
      url: '/api/artifact-validations',
      payload: { changeSetId, version: 1 }
    })
    assert.equal(prepared.statusCode, 200, prepared.body)
    const validationId = prepared.json().id
    const started = await app.inject({
      method: 'POST',
      url: `/api/artifact-validations/${validationId}/start`,
      payload: { presetId: 'validator' }
    })
    assert.equal(started.statusCode, 200, started.body)
    const deadline = Date.now() + 20000
    let state = storage.lifecycle.jobs.get(validationId)
    while (state.state === 'running' && Date.now() < deadline) {
      await delay(30)
      state = storage.lifecycle.jobs.get(validationId)
    }
    assert.equal(state.state, 'pass', JSON.stringify(state))
    assert.equal(
      storage.list().items.some(item => item.title === 'escape'),
      false
    )
    assert.ok(state.report?.reportArtifactId)
    const pending = await app.inject({
      method: 'POST',
      url: '/api/artifact-actions',
      payload: { kind: 'lifecycle', changeSetId, version: 1, validationId }
    })
    assert.equal(pending.statusCode, 200, pending.body)
    const approved = await app.inject({
      method: 'POST',
      url: `/api/artifact-actions/${pending.json().id}/approve`,
      payload: { sourceUserRequestId: 'explicit-user-acceptance' }
    })
    assert.equal(approved.statusCode, 200, approved.body)
    const committed = await app.inject({
      method: 'POST',
      url: `/api/artifact-change-sets/${changeSetId}/commit`,
      payload: {
        version: 1,
        validationId,
        authorizationId: approved.json().authorizationId,
        requestId: 'commit'
      }
    })
    assert.equal(committed.statusCode, 200, committed.body)
    assert.equal(storage.get(node.id).status, 'accepted')
    assert.deepEqual(committed.json().affectedIds, [node.id])
    const report = await app.inject(
      `/api/artifact-validations/${validationId}/report`
    )
    assert.equal(report.statusCode, 200, report.body)
    assert.equal(JSON.parse(report.json().text).verdict, 'pass')
    const history = await app.inject(
      `/api/artifact-validations/${validationId}/history?limit=1`
    )
    assert.equal(history.statusCode, 200, history.body)
    assert.ok(history.json().nextAfterSeq)
  }
)
