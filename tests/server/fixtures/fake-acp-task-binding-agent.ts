import { isRecord } from '../../../src/shared/utils/guards.ts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// The permission request lets tests change assignments between two real MCP creates.
const client = new Client({ name: 'task-binding-probe', version: '1.0.0' })
const app = acp
  .agent({ name: 'task-binding-probe' })
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
    const idle = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: randomUUID(),
        body: 'Idle',
        metadata: { title: 'Idle', tags: [] }
      }
    })
    assert.equal(idle.isError, false)
    return { sessionId: 'task-binding-probe' }
  })
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const text = ctx.params.prompt.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    const input: unknown = JSON.parse(text.text)
    assert.ok(isRecord(input) && typeof input.requestId === 'string')
    assert.ok(
      input.taskIds === undefined ||
        (Array.isArray(input.taskIds) &&
          input.taskIds.every(id => typeof id === 'string'))
    )
    const create = async (requestId: string) => {
      const result = await client.callTool({
        name: 'artifacts_create',
        arguments: {
          requestId,
          body: 'Body',
          metadata: {
            title: requestId,
            tags: [],
            ...(input.taskIds === undefined ? {} : { taskIds: input.taskIds })
          }
        }
      })
      assert.equal(result.isError, false, JSON.stringify(result))
    }
    await create(input.requestId)
    if (input.hold) {
      await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: { toolCallId: 'hold', title: 'Continue task binding probe' },
        options: [{ optionId: 'allow', name: 'Continue', kind: 'allow_once' }]
      })
      await create(input.requestId + '-after')
    }
    return { stopReason: 'end_turn' as const }
  })
const connection = app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM share the same runtime stream.
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
)
await connection.closed
await client.close()
