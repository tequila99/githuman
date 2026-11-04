import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

for (const { presetId, invalidSubmit } of ['validator', 'cursor'].flatMap(
  agentPreset =>
    [false, true].map(invalidReport => ({
      presetId: agentPreset,
      invalidSubmit: invalidReport
    }))
)) {
  test(
    `${presetId}, invalid submit=${invalidSubmit}: ACP → stdio MCP → HTTP: assigned validator reads paginated context, cannot escape, then user commits`,
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
            id: presetId,
            title: 'Validation test',
            command: process.execPath,
            args: [
              join(
                import.meta.dirname,
                '../fixtures/fake-acp-validation-agent.ts'
              ),
              ...(invalidSubmit ? ['--invalid-submit'] : []),
              ...(presetId === 'cursor' ? ['--cursor'] : [])
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
        payload: { presetId }
      })
      assert.equal(started.statusCode, 200, started.body)
      const broadened = await app.inject({
        method: 'POST',
        url: `/api/agent/sessions/${started.json().validatorSessionId}/auto-approve`,
        payload: { enabled: true }
      })
      assert.equal(broadened.statusCode, 409, broadened.body)
      assert.match(broadened.json().message, /fixed permission policy/)
      const deadline = Date.now() + 20000
      let state = storage.lifecycle.jobs.get(validationId)
      while (state.state === 'running' && Date.now() < deadline) {
        await delay(30)
        state = storage.lifecycle.jobs.get(validationId)
      }
      if (invalidSubmit) {
        assert.equal(state.state, 'incomplete', JSON.stringify(state))
        assert.match(
          state.reason ?? '',
          /validations.submit at \/findings\/0\/artifactId/
        )
        assert.match(state.reason ?? '', /Use full artifact UUIDs/)
        assert.equal(storage.catalog.get(node.id)?.status, 'in_review')
        return
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
      // The list tells the requests apart by what the package does, not by the chat name.
      const listed = await app.inject('/api/artifact-actions')
      assert.equal(listed.statusCode, 200, listed.body)
      assert.deepEqual(listed.json().items[0].summary, {
        command: 'accept',
        reason: 'Transport test',
        documentCount: 1
      })
      const approved = await app.inject({
        method: 'POST',
        url: `/api/artifact-actions/${pending.json().id}/approve`,
        payload: { sourceUserRequestId: 'explicit-user-acceptance' }
      })
      assert.equal(approved.statusCode, 200, approved.body)
      const actionId = pending.json().id
      const inspection = await app.inject(`/api/artifact-actions/${actionId}`)
      assert.equal(inspection.statusCode, 200, inspection.body)
      assert.equal(inspection.json().phase, 'authorized')
      assert.equal(inspection.json().ready, true)
      assert.equal(inspection.json().canExecute, true)
      assert.equal(inspection.json().proposal.id, changeSetId)
      assert.equal(
        inspection.json().authorizationId,
        approved.json().authorizationId
      )
      const retried = await app.inject({
        method: 'POST',
        url: `/api/artifact-actions/${actionId}/approve`,
        payload: { sourceUserRequestId: 'explicit-user-acceptance' }
      })
      assert.equal(retried.statusCode, 200, retried.body)
      assert.equal(
        retried.json().authorizationId,
        approved.json().authorizationId
      )
      const unrelated = await app.inject({
        method: 'POST',
        url: `/api/artifact-actions/${actionId}/approve`,
        payload: { sourceUserRequestId: 'another-user-request' }
      })
      assert.equal(unrelated.statusCode, 404)
      const check = await app.inject(
        `/api/artifact-validations/${validationId}/check`
      )
      assert.equal(check.statusCode, 200, check.body)
      assert.equal(check.json().ready, true)
      assert.equal(check.json().validation.state, 'pass')
      assert.equal(storage.get(node.id).status, 'in_review')
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
      const consumed = await app.inject(`/api/artifact-actions/${actionId}`)
      assert.equal(consumed.statusCode, 200, consumed.body)
      assert.equal(consumed.json().phase, 'consumed')
      assert.equal(consumed.json().ready, false)
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
}
