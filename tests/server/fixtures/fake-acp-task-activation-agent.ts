import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Value } from '@sinclair/typebox/value'
import {
  TaskContextSchema,
  TaskActivationResultSchema,
  TaskSchema
} from '../../../src/shared/tasks/schemas.ts'
import {
  ARTIFACT_TASK_PROMPT_HINT,
  ARTIFACT_TASK_INSTRUCTIONS
} from '../../../src/shared/artifact-tools/instructions.ts'
import { isRecord } from '../../../src/shared/utils/guards.ts'

const client = new Client({ name: 'task-activation-probe', version: '1.0.0' })
async function context() {
  const value = await client.callTool({
    name: 'tasks_get_context',
    arguments: {}
  })
  assert.equal(value.isError, false)
  assert.ok(Value.Check(TaskContextSchema, value.structuredContent))
  return value.structuredContent
}
const app = acp
  .agent({ name: 'task-activation-probe' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {}
  }))
  .onRequest(acp.methods.agent.session.new, async ctx => {
    const config = ctx.params.mcpServers[0]
    assert.ok('command' in config)
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: Object.fromEntries(
          config.env.map(entry => [entry.name, entry.value])
        ),
        stderr: 'pipe'
      })
    )
    assert.equal(client.getInstructions(), ARTIFACT_TASK_INSTRUCTIONS)
    assert.equal((await context()).turnId, null)
    return { sessionId: 'activation-probe' }
  })
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const text = ctx.params.prompt.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    assert.ok(
      ctx.params.prompt.some(
        block =>
          block.type === 'text' && block.text === ARTIFACT_TASK_PROMPT_HINT
      )
    )
    const input: unknown = JSON.parse(text.text)
    assert.ok(isRecord(input) && typeof input.requestId === 'string')
    const before = await context()
    assert.ok(before.turnId)
    if (input.mode === 'create_only' || input.mode === 'ambiguous') {
      for (let i = 0; i < (input.mode === 'ambiguous' ? 2 : 1); i++) {
        const created = await client.callTool({
          name: 'tasks_create',
          arguments: {
            requestId: input.requestId + '-' + i,
            input: {
              title: input.requestId + '-' + i,
              state: 'open',
              externalUrl: null
            }
          }
        })
        assert.equal(created.isError, false)
        assert.ok(Value.Check(TaskSchema, created.structuredContent))
      }
      assert.deepEqual(await context(), before)
      if (input.mode === 'ambiguous') {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Which task should I activate?' }
          }
        })
      }
    } else {
      const create = input.mode === 'create_and_activate'
      assert.ok(create || typeof input.taskId === 'string')
      const args = {
        requestId: input.requestId + '-activation',
        turnId: before.turnId,
        assignmentVersion: before.assignment.version,
        ...(create
          ? {
              input: {
                title: input.requestId,
                state: 'open',
                externalUrl: null
              }
            }
          : { taskId: input.taskId })
      }
      const activated = await client.callTool({
        name: create ? 'tasks_create_and_activate' : 'tasks_activate',
        arguments: args
      })
      assert.equal(activated.isError, false, JSON.stringify(activated.content))
      assert.ok(
        Value.Check(TaskActivationResultSchema, activated.structuredContent)
      )
      const taskId = activated.structuredContent.task.id
      assert.deepEqual((await context()).taskIds, [taskId])
      for (const [suffix, taskIds] of [
        ['inherited', undefined],
        ['general', []]
      ] as const) {
        const artifact = await client.callTool({
          name: 'artifacts_create',
          arguments: {
            requestId: input.requestId + '-' + suffix,
            body: '# Body',
            metadata: {
              title: input.requestId + '-' + suffix,
              tags: [],
              ...(taskIds ? { taskIds } : {})
            }
          }
        })
        assert.equal(artifact.isError, false, JSON.stringify(artifact.content))
        assert.ok(isRecord(artifact.structuredContent))
        assert.deepEqual(
          artifact.structuredContent.taskIds,
          taskIds ?? [taskId]
        )
      }
      const replay = await client.callTool({
        name: create ? 'tasks_create_and_activate' : 'tasks_activate',
        arguments: args
      })
      assert.equal(replay.isError, false)
      assert.ok(
        isRecord(replay.structuredContent) &&
          replay.structuredContent.replayed === true
      )
    }
    return { stopReason: 'end_turn' as const }
  })
await app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM share the same runtime stream.
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
).closed
await client.close()
