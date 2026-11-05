import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../../../../src/server/app.ts'
import { createTestDatabase } from '../../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../../src/server/services/artifact-storage.service.ts'
import { DEFAULT_AGENT_PRESETS } from '../../../../src/server/config/agents.ts'
import { isRecord } from '../../../../src/shared/utils/guards.ts'
import {
  localModel,
  usePiEnvironment,
  modelToolOutput,
  type ModelToolCall
} from './fixtures/model-server.ts'

// Actual pi+ACP+MCP+HTTP checks require an explicitly selected installed runtime.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND

for (const verdict of ['pass', 'conflict', 'incomplete'] as const) {
  test(
    `pi validation HTTP bridge: ${verdict}, full paginated coverage, no acceptance`,
    { skip: !COMMAND, timeout: 45000 },
    async t => {
      const root = await mkdtemp(join(tmpdir(), 'pi-http-validation-'))
      usePiEnvironment(t, root, COMMAND!)
      const db = createTestDatabase()
      const storage = new ArtifactStorageService({
        db,
        repositoryPath: root,
        prefix: 'ght-'
      })
      let validationId = ''
      let phase = 'manifest'
      let last: ModelToolCall | undefined
      const keys: string[] = []
      let cursor: string | undefined
      let reads = 0
      let pages = 0
      const requests = await localModel(t, root, body => {
        const previous = modelToolOutput(body)
        let next: ModelToolCall | null = null
        if (last?.name.endsWith('validations_manifest') && previous) {
          pages++
          if (Array.isArray(previous.items)) {
            for (const item of previous.items.filter(isRecord)) {
              if (item.kind === 'artifact' && typeof item.id === 'string') {
                keys.push(item.id)
              }
            }
          }
          cursor =
            typeof previous.nextCursor === 'string'
              ? previous.nextCursor
              : undefined
          if (!cursor) phase = 'read'
        } else if (last?.name.endsWith('validations_read') && previous) {
          reads++
          if (typeof previous.nextOffset === 'number') {
            next = {
              name: last.name,
              arguments: { ...last.arguments, offset: previous.nextOffset }
            }
          } else {
            keys.shift()
          }
        } else if (last?.name.endsWith('validations_create_report')) {
          phase = 'submit'
        } else if (last?.name.endsWith('validations_submit')) {
          phase = 'done'
        }
        if (!next) {
          if (phase === 'manifest') {
            next = {
              name: 'mcp__githuman_artifacts__validations_manifest',
              arguments: {
                id: validationId,
                limit: 1,
                ...(cursor ? { cursor } : {})
              }
            }
          } else if (phase === 'read' && keys.length) {
            next = {
              name: 'mcp__githuman_artifacts__validations_read',
              arguments: {
                id: validationId,
                key: keys[0],
                offset: 0
              }
            }
          } else if (phase === 'read') {
            phase = 'report'
            next = {
              name: 'mcp__githuman_artifacts__validations_create_report',
              arguments: {
                id: validationId,
                body: '# Local pi validation fixture'
              }
            }
          } else if (phase === 'submit') {
            next = {
              name: 'mcp__githuman_artifacts__validations_submit',
              arguments: {
                id: validationId,
                verdict,
                findings: [],
                resolutions: []
              }
            }
          }
        }
        last = next ?? undefined
        return next
      })
      const app = buildApp({
        db,
        repositoryPath: root,
        artifacts: storage,
        agentPresets: DEFAULT_AGENT_PRESETS
      })
      t.after(async () => {
        await app.close()
        db.close()
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100
        })
      })
      await app.listen({ host: '127.0.0.1', port: 0 })
      const user = { kind: 'user' as const, id: 'local' }
      const node = storage.create(
        {
          requestId: 'pi-create',
          body: 'Текст 🧪\n'.repeat(3000),
          metadata: { title: 'Pi fixture', tags: [] }
        },
        user
      )
      storage.catalog.transaction(() =>
        storage.catalog.appendMetadata(
          { ...node, status: 'in_review', metadataVersion: 2 },
          'pi-review',
          user,
          'metadata_updated'
        )
      )
      const proposed = await app.inject({
        method: 'POST',
        url: '/api/artifact-change-sets',
        payload: {
          requestId: 'pi-proposal',
          changeSet: {
            storeId: storage.storeId,
            command: 'accept',
            subjectIds: [node.id],
            expectedVersions: [{ id: node.id, version: 2 }],
            relationChanges: [],
            targetStatuses: [{ artifactId: node.id, status: 'accepted' }],
            supplementDispositions: [],
            reason: 'Local pi fixture'
          }
        }
      })
      assert.equal(proposed.statusCode, 200, proposed.body)
      const prepared = await app.inject({
        method: 'POST',
        url: '/api/artifact-validations',
        payload: { changeSetId: proposed.json().id, version: 1 }
      })
      assert.equal(prepared.statusCode, 200, prepared.body)
      validationId = prepared.json().id
      const started = await app.inject({
        method: 'POST',
        url: `/api/artifact-validations/${validationId}/start`,
        payload: { presetId: 'pi' }
      })
      assert.equal(started.statusCode, 200, started.body)
      const deadline = Date.now() + 30000
      let state = storage.lifecycle.jobs.get(validationId)
      while (state.state === 'running' && Date.now() < deadline) {
        await delay(30)
        state = storage.lifecycle.jobs.get(validationId)
      }
      assert.equal(
        state.state,
        verdict,
        JSON.stringify({
          state,
          session: (
            await app.inject(
              `/api/agent/sessions/${started.json().validatorSessionId}`
            )
          ).json(),
          requests: requests.length
        })
      )
      assert.ok(pages > 1, 'manifest must include multiple pages')
      assert.ok(reads > 1, 'content must include multiple chunks')
      assert.ok(state.report?.text)
      assert.equal(storage.catalog.get(node.id)?.status, 'in_review')
      assert.ok(JSON.stringify(requests[0]).includes('tasks_get_context'))
    }
  )
}
