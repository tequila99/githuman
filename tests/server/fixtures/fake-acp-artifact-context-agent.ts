import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { isRecord } from '../../../src/shared/utils/guards.ts'

// Read related content through the actual ACP-configured MCP process.
const client = new Client({ name: 'artifact-context-probe', version: '1.0.0' })
const app = acp
  .agent({ name: 'artifact-context-probe' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      promptCapabilities: { embeddedContext: process.env.FAKE_EMBEDDED !== '0' }
    }
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
    return { sessionId: 'artifact-context-probe' }
  })
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const texts = ctx.params.prompt.map(block =>
      block.type === 'text'
        ? block.text
        : block.type === 'resource' && 'text' in block.resource
          ? block.resource.text
          : ''
    )
    const context = texts.find(text =>
      text.includes('Artifact metadata snapshot')
    )
    assert.ok(context)
    assert.ok(!context.includes('RELATED_SECRET_BODY'))
    const json = context.split('\n').find(line => line.startsWith('{'))
    assert.ok(json)
    const snapshot: unknown = JSON.parse(json)
    assert.ok(
      isRecord(snapshot) &&
        isRecord(snapshot.artifact) &&
        isRecord(snapshot.outgoing)
    )
    assert.ok(Array.isArray(snapshot.outgoing.items))
    const edge: unknown = snapshot.outgoing.items[0]
    assert.ok(isRecord(edge) && typeof edge.targetId === 'string')
    const meta = await client.callTool({
      name: 'artifacts_get',
      arguments: { id: edge.targetId }
    })
    assert.equal(meta.isError, false)
    let offset = 0
    let content = ''
    for (;;) {
      const result = await client.callTool({
        name: 'artifacts_get_content',
        arguments: { id: edge.targetId, offset }
      })
      assert.equal(result.isError, false)
      const chunk = result.structuredContent
      assert.ok(isRecord(chunk) && typeof chunk.text === 'string')
      content += chunk.text
      if (chunk.nextOffset === null) break
      assert.ok(typeof chunk.nextOffset === 'number')
      offset = chunk.nextOffset
    }
    assert.ok(content.includes('RELATED_SECRET_BODY'))
    const answer = `MCP related content read successfully. [Related document](/#/artifacts?storeId=${String(snapshot.storeId)}&selectedId=${edge.targetId}). Current title: ${String(snapshot.artifact.title)}.`
    await ctx.client.notify(acp.methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: answer }
      }
    })
    return { stopReason: 'end_turn' as const }
  })
const connection = app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams share this runtime contract.
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
)
await connection.closed
await client.close()
