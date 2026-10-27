import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

// A protocol client must never receive the normal CLI startup banner.
const ENTRY = fileURLToPath(
  new URL('../../../src/cli/index.ts', import.meta.url)
)

test('MCP without a server session fails on stderr without opening a writer', () => {
  const env = { ...process.env }
  delete env.GITHUMAN_AGENT_URL
  delete env.GITHUMAN_AGENT_KEY
  const result = spawnSync(process.execPath, [ENTRY, 'mcp', '--stdio'], {
    env,
    encoding: 'utf8',
    timeout: 10_000
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /requires a running GitHuman agent session/)
})

test('MCP rejects arbitrary command options without printing to stdout', () => {
  const result = spawnSync(
    process.execPath,
    [ENTRY, 'mcp', '--stdio', '--url=http://evil.example'],
    { encoding: 'utf8', timeout: 10_000 }
  )
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Usage: githuman mcp --stdio/)
})

test('MCP exits on stdin EOF without writing a startup banner', async () => {
  const child = spawn(process.execPath, [ENTRY, 'mcp', '--stdio'], {
    env: {
      ...process.env,
      GITHUMAN_AGENT_URL: 'http://127.0.0.1:1/',
      GITHUMAN_AGENT_KEY: 'a'.repeat(64)
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  child.stdout.on('data', chunk => {
    stdout += String(chunk)
  })
  child.stderr.resume()
  child.stdin.end()
  const [code] = await once(child, 'exit', {
    signal: AbortSignal.timeout(10_000)
  })
  assert.equal(code, 0)
  assert.equal(stdout, '')
})

test(
  'MCP never follows HTTP redirects and cancellation aborts an active HTTP request',
  { timeout: 15_000 },
  async t => {
    let mode = 'redirect'
    let hits = 0
    let markClosed: (() => void) | undefined
    const responseClosed = new Promise<void>(resolve => {
      markClosed = resolve
    })
    const http = createServer((request, response) => {
      hits++
      request.resume()
      if (mode === 'redirect') {
        response.writeHead(307, { location: '/stolen' })
        response.end()
      } else {
        response.once('close', () => markClosed?.())
      }
    })
    t.after(() => {
      http.closeAllConnections()
      http.close()
    })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    assert.ok(address && typeof address !== 'string')
    const client = new Client({ name: 'fault-probe', version: '1.0.0' })
    t.after(() => client.close())
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [ENTRY, 'mcp', '--stdio'],
        env: {
          GITHUMAN_AGENT_URL: `http://127.0.0.1:${address.port}/`,
          GITHUMAN_AGENT_KEY: 'b'.repeat(64)
        },
        stderr: 'pipe'
      })
    )
    const redirect = await client.callTool({
      name: 'types_list',
      arguments: {}
    })
    assert.equal(redirect.isError, true)
    assert.equal(hits, 1)
    mode = 'hang'
    await assert.rejects(
      client.callTool({ name: 'types_list', arguments: {} }, undefined, {
        timeout: 200
      })
    )
    await Promise.race([
      responseClosed,
      new Promise((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('HTTP was not cancelled')),
          3000
        )
        timeout.unref()
      })
    ])
    assert.equal(hits, 2)
  }
)

function text(result: unknown): string {
  return JSON.stringify(result)
}

test(
  'MCP reports invalid parameters, unreadable responses and a missing server separately',
  { timeout: 15_000 },
  async t => {
    const http = createServer((request, response) => {
      request.resume()
      response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('bad gateway')
    })
    t.after(() => {
      http.closeAllConnections()
      http.close()
    })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    assert.ok(address && typeof address !== 'string')
    const connect = async (url: string) => {
      const client = new Client({ name: 'error-probe', version: '1.0.0' })
      t.after(() => client.close())
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [ENTRY, 'mcp', '--stdio'],
          env: { GITHUMAN_AGENT_URL: url, GITHUMAN_AGENT_KEY: 'c'.repeat(64) },
          stderr: 'pipe'
        })
      )
      return client
    }
    const proxied = await connect(`http://127.0.0.1:${address.port}/`)
    const invalid = await proxied.callTool({
      name: 'artifacts_get',
      arguments: { id: 'secret-looking-value' }
    })
    assert.equal(invalid.isError, true)
    assert.match(text(invalid), /Invalid parameters for artifacts_get: \/id/)
    assert.doesNotMatch(text(invalid), /secret-looking-value/)
    const unknown = await proxied.callTool({
      name: 'no_such_tool',
      arguments: {}
    })
    assert.equal(unknown.isError, true)
    assert.match(text(unknown), /Unknown artifact tool/)
    const unreadable = await proxied.callTool({
      name: 'types_list',
      arguments: {}
    })
    assert.equal(unreadable.isError, true)
    assert.match(text(unreadable), /unreadable response \(HTTP 502\)/)

    const missing = await connect('http://127.0.0.1:1/')
    const down = await missing.callTool({ name: 'types_list', arguments: {} })
    assert.equal(down.isError, true)
    assert.match(text(down), /server is unavailable/)
  }
)
