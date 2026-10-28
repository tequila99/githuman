import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { isRecord } from '../../../src/shared/utils/guards.ts'

// Exercise the actual ACP-configured CLI bridge instead of replacing validation internals.
const client = new Client({ name: 'validation-probe', version: '1.0.0' })
const agent = acp
  .agent({ name: 'validation-probe' })
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
    return { sessionId: 'validation-probe' }
  })
  .onRequest(acp.methods.agent.session.prompt, async ctx => {
    const text = ctx.params.prompt.find(block => block.type === 'text')
    assert.ok(text && text.type === 'text')
    const id = /validation ID ([a-f0-9-]+)/.exec(text.text)?.[1]
    assert.ok(id)
    const denied = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: 'validator-escape',
        body: 'escape',
        metadata: { title: 'escape', tags: [] }
      }
    })
    assert.equal(denied.isError, true)
    const nested = await client.callTool({
      name: 'validations_start',
      arguments: { id, presetId: 'validator' }
    })
    assert.equal(nested.isError, true)
    let cursor: string | undefined
    do {
      const page = await client.callTool({
        name: 'validations_manifest',
        arguments: { id, limit: 1, ...(cursor ? { cursor } : {}) }
      })
      assert.equal(page.isError, false)
      assert.ok(isRecord(page.structuredContent))
      const value = page.structuredContent
      assert.ok(Array.isArray(value.items))
      for (const item of value.items) {
        assert.ok(isRecord(item))
        if (item.kind !== 'artifact' && item.kind !== 'review') continue
        assert.equal(typeof item.id, 'string')
        const key =
          item.kind === 'review' ? `review:${String(item.id)}` : item.id
        let offset = 0
        for (;;) {
          const chunk = await client.callTool({
            name: 'validations_read',
            arguments: { id, key, offset }
          })
          assert.equal(chunk.isError, false)
          assert.ok(isRecord(chunk.structuredContent))
          if (chunk.structuredContent.nextOffset === null) break
          assert.ok(typeof chunk.structuredContent.nextOffset === 'number')
          offset = chunk.structuredContent.nextOffset
        }
      }
      cursor =
        typeof value.nextCursor === 'string' ? value.nextCursor : undefined
    } while (cursor)
    const submitted = await client.callTool({
      name: 'validations_submit',
      arguments: {
        id,
        verdict: 'pass',
        findings: [],
        resolutions: [],
        report: '# Validation passed\nAll mandatory context read.'
      }
    })
    assert.equal(submitted.isError, false)
    return { stopReason: 'end_turn' as const }
  })
const connection = agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams have equivalent runtime contracts.
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
)
await connection.closed
await client.close()
