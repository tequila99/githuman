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
    let callIndex = 0
    const permission = async (
      request: Parameters<typeof client.callTool>[0],
      allowed: boolean
    ) => {
      const toolCallId = `validation-tool-${++callIndex}`
      const cursor = process.argv.includes('--cursor')
      const codex = !cursor && callIndex % 2 === 0
      if (codex || cursor) {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'tool_call',
            title: 'MCP validation call',
            toolCallId,
            kind: cursor ? 'other' : 'execute',
            rawInput: cursor
              ? {
                  providerIdentifier: 'githuman_artifacts',
                  toolName: request.name,
                  args: request.arguments
                }
              : {
                  server: 'githuman_artifacts',
                  tool: request.name,
                  arguments: request.arguments
                }
          }
        })
      }
      const response = await ctx.client.request<acp.RequestPermissionResponse>(
        acp.methods.client.session.requestPermission,
        {
          sessionId: ctx.params.sessionId,
          ...(codex ? { _meta: { is_mcp_tool_approval: true } } : {}),
          toolCall: cursor
            ? { toolCallId, kind: 'other', title: 'MCP permission' }
            : codex
              ? { toolCallId, kind: 'execute' }
              : {
                  toolCallId,
                  name: `mcp__githuman_artifacts__${request.name}`,
                  rawInput: request.arguments
                },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
          ]
        }
      )
      assert.deepEqual(response.outcome, {
        outcome: 'selected',
        optionId: allowed ? 'allow' : 'reject'
      })
    }
    const callTool = async (request: Parameters<typeof client.callTool>[0]) => {
      await permission(request, true)
      return client.callTool(request)
    }
    await permission(
      {
        name: 'artifacts_create',
        arguments: {
          requestId: 'escape',
          body: 'escape',
          metadata: { title: 'escape', tags: [] }
        }
      },
      false
    )
    await permission(
      {
        name: 'validations_get',
        arguments: { id: '11111111-1111-4111-8111-111111111111' }
      },
      false
    )
    await permission(
      {
        name: 'artifacts_get_content',
        arguments: { id: '11111111-1111-4111-8111-111111111111' }
      },
      false
    )
    await permission(
      {
        name: 'validations_read',
        arguments: { id, key: '11111111-1111-4111-8111-111111111111' }
      },
      false
    )
    await permission(
      { name: 'validations_manifest', arguments: { id, limit: -1 } },
      false
    )
    const denied = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: 'validator-escape',
        body: 'escape',
        metadata: { title: 'escape', tags: [] }
      }
    })
    assert.equal(denied.isError, true)
    const metadataUpdate = {
      name: 'artifacts_update_metadata',
      arguments: {
        id,
        requestId: 'validator-metadata-escape',
        expectedVersion: 1,
        metadata: { title: 'escape', tags: [] }
      }
    }
    await permission(metadataUpdate, false)
    assert.equal((await client.callTool(metadataUpdate)).isError, true)
    for (const operation of [
      { name: 'tasks_get_context', arguments: {} },
      {
        name: 'tasks_activate',
        arguments: {
          requestId: 'escape-activate',
          turnId: '11111111-1111-4111-8111-111111111111',
          assignmentVersion: 0,
          taskId: '11111111-1111-4111-8111-111111111111'
        }
      },
      {
        name: 'tasks_create_and_activate',
        arguments: {
          requestId: 'escape-create-activate',
          turnId: '11111111-1111-4111-8111-111111111111',
          assignmentVersion: 0,
          input: { title: 'escape', externalUrl: null, state: 'open' }
        }
      }
    ]) {
      await permission(operation, false)
      const deniedActivation = await client.callTool(operation)
      assert.equal(deniedActivation.isError, true)
    }
    const nested = await client.callTool({
      name: 'validations_start',
      arguments: { id, presetId: 'validator' }
    })
    assert.equal(nested.isError, true)
    let cursor: string | undefined
    do {
      const page = await callTool({
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
          const chunk = await callTool({
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
    assert.match(text.text, /never abbreviate IDs/)
    await permission(
      {
        name: 'validations_submit',
        arguments: {
          id,
          verdict: 'pass',
          findings: [
            { artifactId: '15100665', quote: 'Text', message: 'Finding' }
          ],
          resolutions: []
        }
      },
      false
    )
    if (process.argv.includes('--invalid-submit')) {
      return { stopReason: 'end_turn' as const }
    }
    const submitted = await callTool({
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
