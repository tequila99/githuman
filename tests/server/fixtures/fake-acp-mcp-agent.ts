import { isRecord } from '../../../src/shared/utils/guards.ts'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Verify ACP v1 configuration by using it to launch an actual MCP subprocess.
const clients: Client[] = []
const app = acp
  .agent({ name: 'fake-acp-mcp-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {}
  }))
  .onRequest(acp.methods.agent.session.new, async ctx => {
    try {
      assert.equal(ctx.params.mcpServers.length, 1)
      const config = ctx.params.mcpServers[0]
      assert.ok(config)
      assert.ok(!('type' in config))
      assert.ok('command' in config)
      const client = new Client({ name: 'acp-probe', version: '1.0.0' })
      clients.push(client)
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: Object.fromEntries(
          config.env.map(entry => [entry.name, entry.value])
        ),
        stderr: 'pipe'
      })
      await client.connect(transport)
      const tools = await client.listTools()
      if (config.name === 'githuman_artifacts') {
        assert.ok(tools.tools.some(tool => tool.name === 'artifacts_create'))
        assert.ok(!tools.tools.some(tool => tool.name.includes('authorize')))
        const input = {
          requestId: 'http-probe',
          body: 'Текст 🧪\n"quoted"\t\\',
          metadata: { title: 'HTTP probe', tags: [] }
        }
        const created = await client.callTool({
          name: 'artifacts_create',
          arguments: input
        })
        assert.equal(created.isError, false)
        assert.ok(isRecord(created.structuredContent))
        const artifact = created.structuredContent
        assert.equal(typeof artifact.id, 'string')
        const repeated = await client.callTool({
          name: 'artifacts_create',
          arguments: input
        })
        assert.deepEqual(repeated.structuredContent, artifact)
        const conflict = await client.callTool({
          name: 'artifacts_create',
          arguments: { ...input, body: 'different' }
        })
        assert.equal(conflict.isError, true)
        assert.ok(isRecord(conflict.structuredContent))
        assert.equal(conflict.structuredContent.statusCode, 409)
        const content = await client.callTool({
          name: 'artifacts_get_content',
          arguments: { id: artifact.id }
        })
        assert.equal(content.isError, false)
        assert.ok(isRecord(content.structuredContent))
        assert.ok(typeof content.structuredContent.text === 'string')
        assert.ok(content.structuredContent.text.endsWith(input.body))
        const searched = await client.callTool({
          name: 'artifacts_search',
          arguments: {
            query: 'HTTP probe',
            mode: 'exact',
            filters: { statuses: ['draft'] }
          }
        })
        assert.equal(searched.isError, false)
        assert.ok(isRecord(searched.structuredContent))
        assert.ok(Array.isArray(searched.structuredContent.items))
        assert.ok(
          searched.structuredContent.items.some(
            item => isRecord(item) && item.id === artifact.id
          )
        )
        const nulSearch = await client.callTool({
          name: 'artifacts_search',
          arguments: { query: 'abc\u0000def', mode: 'exact' }
        })
        assert.equal(nulSearch.isError, true)
        assert.ok(isRecord(nulSearch.structuredContent))
        assert.equal(nulSearch.structuredContent.statusCode, 400)
        const url = config.env.find(
          entry => entry.name === 'GITHUMAN_AGENT_URL'
        )?.value
        const key = config.env.find(
          entry => entry.name === 'GITHUMAN_AGENT_KEY'
        )?.value
        assert.ok(url && key)
        const bridge = new URL('/api/agent/artifacts/artifacts.list', url)
        const deniedHeaders: Record<string, string>[] = [
          {},
          { authorization: 'Bearer ' + '0'.repeat(64) },
          { authorization: 'Bearer ' + key, origin: 'http://evil.example' }
        ]
        for (const headers of deniedHeaders) {
          const denied = await fetch(bridge, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: '{}'
          })
          assert.equal(
            denied.status,
            403,
            'denied header names: ' + Object.keys(headers).join(',')
          )
          await denied.arrayBuffer()
        }
        const actor = await fetch(bridge, {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + key,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ actor: { kind: 'user', id: 'fake' } })
        })
        assert.equal(actor.status, 400)
        await actor.arrayBuffer()
        const elsewhere = await fetch(new URL('/api/tasks', url), {
          headers: {
            authorization: 'Bearer ' + key,
            'x-forwarded-for': '192.168.10.9'
          }
        })
        assert.ok(elsewhere.status === 401 || elsewhere.status === 403)
        await elsewhere.arrayBuffer()
        await client.close()
        return { sessionId: 'http-mcp-smoke-passed' }
      }
      assert.deepEqual(
        tools.tools.map(tool => tool.name),
        ['probe_create', 'probe_get']
      )
      const created = await client.callTool({
        name: 'probe_create',
        arguments: { body: 'Текст 🧪\n"quoted"\t\\' }
      })
      assert.equal(created.isError, undefined)
      const read = await client.callTool({
        name: 'probe_get',
        arguments: { id: '1' }
      })
      assert.deepEqual(read.content, [
        { type: 'text', text: 'Текст 🧪\n"quoted"\t\\' }
      ])
      await client.close()
      return { sessionId: 'mcp-smoke-passed' }
    } catch (error) {
      throw new acp.RequestError(
        -32603,
        error instanceof Error ? error.message : 'MCP probe failed'
      )
    }
  })
const connection = app.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM expose the same stream with different typings
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
  )
)
await connection.closed
await Promise.all(clients.map(client => client.close()))
