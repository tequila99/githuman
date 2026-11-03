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

// The full task workflow uses real pi and the authenticated MCP HTTP route.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND

for (const mode of [
  'activate',
  'create_and_activate',
  'explicit_empty',
  'explicit_initial',
  'create_only',
  'conflict'
]) {
  test(
    `pi chat task workflow: ${mode}`,
    { skip: !COMMAND, timeout: 25000 },
    async t => {
      const root = await mkdtemp(join(tmpdir(), 'pi-task-workflow-'))
      usePiEnvironment(t, root, COMMAND!)
      const db = createTestDatabase()
      const storage = new ArtifactStorageService({
        db,
        repositoryPath: root,
        prefix: 'ght-'
      })
      const actor = { kind: 'user' as const, id: 'local' }
      const initial = storage.tasks.create(
        'pi-task-a',
        { title: 'Initial', externalUrl: null, state: 'open' },
        actor
      ).id
      const target = storage.tasks.create(
        'pi-task-b',
        { title: 'Target', externalUrl: null, state: 'open' },
        actor
      ).id
      let step = 0
      let selected =
        mode === 'create_only' || mode === 'conflict' ? initial : target
      const operations: ModelToolCall[] = []
      const requests = await localModel(t, root, body => {
        const previous = modelToolOutput(body)
        let call: ModelToolCall | null = null
        if (step === 0) {
          call = {
            name: 'mcp__githuman_artifacts__tasks_get_context',
            arguments: {}
          }
        } else if (step === 1) {
          assert.ok(
            previous &&
              typeof previous.turnId === 'string' &&
              isRecord(previous.assignment)
          )
          if (mode === 'create_only') {
            call = {
              name: 'mcp__githuman_artifacts__tasks_create',
              arguments: {
                requestId: 'pi-create-only',
                input: { title: 'Unselected', state: 'open', externalUrl: null }
              }
            }
          } else {
            call = {
              name: `mcp__githuman_artifacts__tasks_${mode === 'create_and_activate' ? 'create_and_activate' : 'activate'}`,
              arguments: {
                requestId: 'pi-activation',
                turnId: previous.turnId,
                assignmentVersion:
                  Number(previous.assignment.version) +
                  (mode === 'conflict' ? 1 : 0),
                ...(mode === 'create_and_activate'
                  ? {
                      input: {
                        title: 'Created and selected',
                        state: 'open',
                        externalUrl: null
                      }
                    }
                  : { taskId: target })
              }
            }
          }
        } else if (step === 2) {
          if (mode === 'conflict') {
            call = {
              name: 'mcp__githuman_artifacts__tasks_get_context',
              arguments: {}
            }
          } else {
            if (mode === 'create_and_activate') {
              assert.ok(
                previous &&
                  isRecord(previous.task) &&
                  typeof previous.task.id === 'string'
              )
              selected = previous.task.id
            }
            call = {
              name: 'mcp__githuman_artifacts__artifacts_create',
              arguments: {
                requestId: 'pi-artifact',
                body: '# pi task fixture',
                metadata: {
                  title: 'Pi task result',
                  tags: [],
                  ...(mode === 'explicit_empty'
                    ? { taskIds: [] }
                    : mode === 'explicit_initial'
                      ? { taskIds: [initial] }
                      : {})
                }
              }
            }
          }
        }
        step++
        if (call) operations.push(call)
        return call
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
      const created = await app.inject({
        method: 'POST',
        url: '/api/agent/sessions',
        payload: { presetId: 'pi' }
      })
      assert.equal(created.statusCode, 201, created.body)
      const id = created.json().id
      const info = async () =>
        (await app.inject(`/api/agent/sessions/${id}`)).json()
      const deadline = Date.now() + 18000
      while ((await info()).status === 'starting' && Date.now() < deadline) {
        await delay(20)
      }
      assert.equal((await info()).status, 'ready', JSON.stringify(await info()))
      storage.tasks.assignSession(
        id,
        { requestId: 'pi-initial', expectedVersion: 0, taskIds: [initial] },
        actor
      )
      const automatic = await app.inject({
        method: 'POST',
        url: `/api/agent/sessions/${id}/auto-approve`,
        payload: { enabled: true }
      })
      assert.equal(automatic.statusCode, 204, automatic.body)
      const prompted = await app.inject({
        method: 'POST',
        url: `/api/agent/sessions/${id}/prompt`,
        payload: { text: 'Execute the task fixture workflow.' }
      })
      assert.equal(prompted.statusCode, 202, prompted.body)
      while ((await info()).status === 'busy' && Date.now() < deadline) {
        await delay(20)
      }
      assert.equal((await info()).status, 'ready', JSON.stringify(await info()))
      assert.deepEqual(storage.tasks.assignment(id).taskIds, [selected])
      const artifact = storage
        .list()
        .items.find(value => value.title === 'Pi task result')
      if (mode === 'conflict') {
        assert.equal(artifact, undefined)
        assert.equal(
          operations.filter(value => value.name.endsWith('tasks_activate'))
            .length,
          1
        )
        assert.equal(
          operations.at(-1)?.name,
          'mcp__githuman_artifacts__tasks_get_context'
        )
      } else {
        assert.deepEqual(
          artifact?.taskIds,
          mode === 'explicit_empty'
            ? []
            : mode === 'explicit_initial'
              ? [initial]
              : [selected]
        )
      }
      assert.ok(JSON.stringify(requests[0]).includes('tasks_get_context'))
    }
  )
}
