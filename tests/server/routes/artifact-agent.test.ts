import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { MAX_ARTIFACT_BODY_BYTES } from '../../../src/shared/artifacts/constants.ts'
import {
  ARTIFACT_AGENT_KEY_ENV,
  ARTIFACT_AGENT_URL_ENV
} from '../../../src/shared/artifacts/mcp-constants.ts'

// Real CLI entry point, started exactly as the server starts it for an agent.
const CLI_ENTRY = join(import.meta.dirname, '../../../src/cli/index.ts')
// Page size for reading a stored document back through MCP.
const CONTENT_PAGE_BYTES = 64 * 1024

// Exercise the same ACP preset entrypoint used by the transport probe.
const PRESET = {
  id: 'fake',
  title: 'Fake MCP',
  command: process.execPath,
  args: [join(import.meta.dirname, '../fixtures/fake-acp-mcp-agent.ts')],
  autoApprovesEdits: false
}

/** Starts a fake agent session and returns the key the server gave to its MCP process. */
async function startSession(app: FastifyInstance) {
  let authorization: string | undefined
  app.addHook('onRequest', async request => {
    if (request.url.includes('/agent/artifacts/')) {
      authorization ??= request.headers.authorization
    }
  })
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const created = await app.inject({
    method: 'POST',
    url: '/api/agent/sessions',
    payload: { presetId: 'fake' }
  })
  assert.equal(created.statusCode, 201, created.body)
  const sessionId = created.json<{ id: string }>().id
  let state: { status: string; error: string | null } = {
    status: 'starting',
    error: null
  }
  const deadline = Date.now() + 20_000
  while (state.status === 'starting' && Date.now() < deadline) {
    await delay(20)
    state = (await app.inject(`/api/agent/sessions/${sessionId}`)).json()
  }
  assert.equal(state.status, 'ready', state.error ?? 'agent timeout')
  assert.ok(authorization)
  return { url, sessionId, authorization }
}

function setup(t: TestContext, now?: () => number, allowedHosts?: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'ght-http-mcp-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const app = buildApp({
    repositoryPath: root,
    db,
    artifacts: storage,
    agentPresets: [PRESET],
    allowedHosts,
    now
  })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  return { app, storage, db }
}

test(
  'actual ACP → CLI stdio → HTTP → storage preserves data, actor, errors and revoke',
  { timeout: 30_000 },
  async t => {
    const { app, storage } = setup(t)
    let authorization: string | undefined
    app.addHook('onRequest', async request => {
      if (request.url.includes('/agent/artifacts/')) {
        authorization ??= request.headers.authorization
      }
    })
    const url = await app.listen({ host: '127.0.0.1', port: 0 })
    const created = await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      payload: { presetId: 'fake' }
    })
    assert.equal(created.statusCode, 201, created.body)
    const sessionId = created.json<{ id: string }>().id
    let state: { status: string; error: string | null } = {
      status: 'starting',
      error: null
    }
    const deadline = Date.now() + 20_000
    while (state.status === 'starting' && Date.now() < deadline) {
      await delay(20)
      state = (await app.inject(`/api/agent/sessions/${sessionId}`)).json()
    }
    assert.equal(state.status, 'ready', state.error ?? 'agent timeout')
    assert.ok(authorization)
    assert.equal(storage.list().items.length, 1)
    const artifact = storage.list().items[0]
    const history = storage.history(artifact.id)
    assert.ok(JSON.stringify(history).includes(sessionId))
    const bridge = (operation: string, body: unknown, headers = {}) =>
      fetch(`${url}/api/agent/artifacts/${operation}`, {
        method: 'POST',
        headers: {
          authorization: authorization!,
          'content-type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      })
    const badHost = await app.inject({
      method: 'POST',
      url: '/api/agent/artifacts/artifacts.list',
      headers: { authorization, host: 'evil.example' },
      payload: {}
    })
    assert.equal(badHost.statusCode, 403)
    const other = setup(t)
    const foreignRuntime = await other.app.inject({
      method: 'POST',
      url: '/api/agent/artifacts/artifacts.list',
      headers: { authorization },
      payload: {}
    })
    assert.equal(foreignRuntime.statusCode, 403)
    const all = await bridge('artifacts.get', { id: artifact.id })
    assert.deepEqual(await all.json(), artifact)
    const escaped = await bridge('artifacts.create', {
      requestId: 'escaped',
      body: '\u0001'.repeat(MAX_ARTIFACT_BODY_BYTES),
      metadata: { title: 'Escaped', tags: [] }
    })
    assert.equal(escaped.status, 200, await escaped.text())
    const large = await bridge('artifacts.create', {
      requestId: 'too-large',
      body: 'я'.repeat(MAX_ARTIFACT_BODY_BYTES),
      metadata: { title: 'Large', tags: [] }
    })
    assert.equal(large.status, 413)
    await large.arrayBuffer()
    const task = await bridge('tasks.create', {
      requestId: 'task',
      input: { title: 'Task', state: 'open', externalUrl: null }
    })
    const taskResult = await task.json()
    assert.equal(task.status, 200)
    const types = await bridge('types.list', {})
    assert.deepEqual(await types.json(), storage.types.list())
    const unknown = await bridge('change_sets.commit', {})
    assert.equal(unknown.status, 400)
    await unknown.arrayBuffer()
    const closed = await app.inject({
      method: 'DELETE',
      url: `/api/agent/sessions/${sessionId}`
    })
    assert.equal(closed.statusCode, 204, closed.body)
    const replay = await bridge('artifacts.list', {})
    assert.equal(replay.status, 403)
    await replay.arrayBuffer()
    assert.ok(taskResult)
  }
)

test(
  'wildcard IPv4 and IPv6 binds provide a usable MCP server URL',
  { timeout: 30_000 },
  async t => {
    for (const host of ['0.0.0.0', '::']) {
      await t.test(host, async child => {
        const { app, storage } = setup(child)
        try {
          await app.listen({ host, port: 0 })
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(String(error.code))
          ) {
            child.skip('IPv6 is unavailable on this host')
            return
          }
          throw error
        }
        const created = await app.inject({
          method: 'POST',
          url: '/api/agent/sessions',
          payload: { presetId: 'fake' }
        })
        const id = created.json<{ id: string }>().id
        let state: { status: string; error: string | null }
        const deadline = Date.now() + 20_000
        do {
          await delay(20)
          state = (await app.inject(`/api/agent/sessions/${id}`)).json()
        } while (state.status === 'starting' && Date.now() < deadline)
        assert.equal(state.status, 'ready', state.error ?? 'timeout')
        assert.equal(storage.list().items.length, 1)
      })
    }
  }
)

test(
  'MCP stdio carries a worst-case escaped create and reads the exact bytes back',
  { timeout: 60_000 },
  async t => {
    const { app } = setup(t)
    const { url, authorization } = await startSession(app)
    const client = new Client({ name: 'limit-probe', version: '1.0.0' })
    t.after(() => client.close())
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [CLI_ENTRY, 'mcp', '--stdio'],
        env: {
          [ARTIFACT_AGENT_URL_ENV]: `${url}/`,
          [ARTIFACT_AGENT_KEY_ENV]: authorization.slice('Bearer '.length)
        },
        stderr: 'pipe'
      })
    )
    // Control characters escape to six bytes each, which is the largest JSON form.
    const body = '\u0001'.repeat(MAX_ARTIFACT_BODY_BYTES)
    const tags = Array.from(
      { length: 20 },
      (_, index) => String(index).padStart(3, '\u0001') + '\u0001'.repeat(125)
    )
    const created = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: 'worst-case',
        body,
        metadata: { title: '\u0001'.repeat(1000), tags }
      }
    })
    assert.notEqual(created.isError, true, JSON.stringify(created.content))
    const id = (created.structuredContent as { id: string }).id
    let text = ''
    let offset: number | null = 0
    let total = 0
    while (offset !== null) {
      const page = await client.callTool({
        name: 'artifacts_get_content',
        arguments: { id, offset, limit: CONTENT_PAGE_BYTES }
      })
      assert.notEqual(page.isError, true, JSON.stringify(page.content))
      const chunk = page.structuredContent as {
        text: string
        nextOffset: number | null
        totalBytes: number
      }
      text += chunk.text
      total = chunk.totalBytes
      offset = chunk.nextOffset
    }
    assert.equal(Buffer.byteLength(text), total)
    assert.ok(text.endsWith(body))
    // The same connection stays usable after the largest message.
    const listed = await client.callTool({ name: 'types_list', arguments: {} })
    assert.notEqual(listed.isError, true)
    // A body over the byte limit but under the character limit gets a readable server error.
    const tooLarge = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: 'too-large-bytes',
        body: 'я'.repeat(MAX_ARTIFACT_BODY_BYTES),
        metadata: { title: 'Large', tags: [] }
      }
    })
    assert.equal(tooLarge.isError, true)
    assert.equal(
      (tooLarge.structuredContent as { statusCode: number }).statusCode,
      413
    )
    // A body over the character limit fails local validation and names the field.
    const overLimit = await client.callTool({
      name: 'artifacts_create',
      arguments: {
        requestId: 'too-large-chars',
        body: 'a'.repeat(MAX_ARTIFACT_BODY_BYTES + 1),
        metadata: { title: 'Large', tags: [] }
      }
    })
    assert.equal(overLimit.isError, true)
    assert.match(JSON.stringify(overLimit.content), /\/body/)
  }
)

test(
  'bridge key grants only the bridge route, and only to a valid key',
  { timeout: 60_000 },
  async t => {
    const { app, storage } = setup(t, undefined, ['lan.test'])
    // Revokes the session after the access hook accepted the key and before the handler runs.
    const live = { sessionId: '' }
    app.addHook('preHandler', async request => {
      if (request.headers['x-revoke'] === '1') {
        await app.inject({
          method: 'DELETE',
          url: `/api/agent/sessions/${live.sessionId}`
        })
      }
    })
    const { sessionId, authorization } = await startSession(app)
    live.sessionId = sessionId
    const bridge = (
      headers: Record<string, string>,
      payload: unknown = {},
      operation = 'artifacts.list'
    ) =>
      app.inject({
        method: 'POST',
        url: `/api/agent/artifacts/${operation}`,
        headers,
        payload: payload as object
      })
    // A request from the network: no loopback socket, an allowed Host, no device cookie.
    const remote = { host: 'lan.test', authorization }
    const remoteOptions = { remoteAddress: '192.168.1.20' }

    for (const bad of [
      undefined,
      'Bearer ',
      'Bearer ' + 'a'.repeat(64),
      'Bearer ' + 'g'.repeat(64),
      'Bearer ' + authorization.slice(7, -1),
      'Basic ' + authorization.slice(7)
    ]) {
      const denied = await bridge(
        bad === undefined ? {} : { authorization: bad }
      )
      assert.equal(denied.statusCode, 403, String(bad))
    }

    const lan = await app.inject({
      method: 'POST',
      url: '/api/agent/artifacts/artifacts.list',
      headers: remote,
      payload: {},
      ...remoteOptions
    })
    assert.equal(lan.statusCode, 200, lan.body)
    const lanNoKey = await app.inject({
      method: 'POST',
      url: '/api/agent/artifacts/artifacts.list',
      headers: { host: 'lan.test' },
      payload: {},
      ...remoteOptions
    })
    assert.equal(lanNoKey.statusCode, 403)

    // The same key must not unlock any other API for a request from the network.
    for (const url of [
      '/api/agent/sessions',
      '/api/devices',
      '/api/reviews',
      '/api/agent/artifacts/artifacts.list'
    ]) {
      const other = await app.inject({
        method: 'GET',
        url,
        headers: remote,
        ...remoteOptions
      })
      assert.ok(
        [401, 404].includes(other.statusCode),
        `${url} ${other.statusCode}`
      )
    }
    const otherPost = await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      headers: remote,
      payload: { presetId: 'fake' },
      ...remoteOptions
    })
    assert.equal(otherPost.statusCode, 401)

    // The server sets the actor; the request cannot override it.
    for (const [operation, payload] of [
      [
        'artifacts.create',
        {
          requestId: 'actor',
          body: 'x',
          metadata: { title: 'T', tags: [] },
          actor: { kind: 'user', id: 'someone' }
        }
      ],
      [
        'tasks.create',
        {
          requestId: 'actor-task',
          input: { title: 'T', state: 'open', externalUrl: null },
          userRequested: true
        }
      ]
    ] as const) {
      const rejected = await bridge({ authorization }, payload, operation)
      assert.equal(rejected.statusCode, 400, operation)
    }
    const first = await bridge(
      { authorization },
      {
        requestId: 'retry',
        body: 'once',
        metadata: { title: 'Retry', tags: [] }
      },
      'artifacts.create'
    )
    const second = await bridge(
      { authorization },
      {
        requestId: 'retry',
        body: 'once',
        metadata: { title: 'Retry', tags: [] }
      },
      'artifacts.create'
    )
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(first.json().id, second.json().id)
    const created = storage.get(first.json().id)
    const events = storage.history(created.id).items
    assert.ok(events.length > 0)
    for (const event of events) {
      assert.deepEqual(event.actor, { kind: 'agent', id: sessionId })
    }

    // A key revoked between the access hook and the handler never writes.
    // The server also destroys the registered request, so the call may fail at the socket.
    const before = storage.list().items.length
    const raced = await bridge(
      { authorization, 'x-revoke': '1' },
      {
        requestId: 'raced',
        body: 'late',
        metadata: { title: 'Late', tags: [] }
      },
      'artifacts.create'
    ).then(
      response => response.statusCode,
      () => 'reset'
    )
    assert.notEqual(raced, 200)
    assert.equal(storage.list().items.length, before)
  }
)

test(
  'a server on a pipe gives the agent session a clear error instead of silent missing tools',
  { timeout: 30_000 },
  async t => {
    const { app } = setup(t)
    const dir = mkdtempSync(join(tmpdir(), 'ght-pipe-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    await app.listen({ path: join(dir, 'server.sock') })
    const created = await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      payload: { presetId: 'fake' }
    })
    assert.equal(created.statusCode, 201, created.body)
    const id = created.json<{ id: string }>().id
    let state: { status: string; error: string | null } = {
      status: 'starting',
      error: null
    }
    const deadline = Date.now() + 20_000
    while (state.status === 'starting' && Date.now() < deadline) {
      await delay(20)
      state = (await app.inject(`/api/agent/sessions/${id}`)).json()
    }
    assert.notEqual(state.status, 'ready')
    assert.match(state.error ?? '', /need a TCP address/)
  }
)
