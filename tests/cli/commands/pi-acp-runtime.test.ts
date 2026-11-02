import { terminateProcesses } from '../../../src/server/services/terminal/processes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import * as acp from '@agentclientprotocol/sdk'
import { localModel } from '../../server/adapters/pi-acp/fixtures/model-server.ts'

// Set ENTRY to an unpacked CLI to verify the shipped extension layout.
const ENTRY =
  process.env.GITHUMAN_PI_SPIKE_ENTRY ??
  fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url))
// Keep ordinary CLI tests independent of an installed pi runtime.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND

test(
  'shipped pi CLI completes a real ACP/MCP permission round trip',
  { skip: !COMMAND, timeout: 20000 },
  async t => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-packed-smoke-'))
    let calls = 0
    let approvals = 0
    const requests = await localModel(t, dir, () =>
      calls++ === 0
        ? { name: 'mcp__githuman_artifacts__probe', arguments: { value: 5 } }
        : null
    )
    const child = spawn(process.execPath, [ENTRY, 'pi-acp', '--stdio'], {
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        PI_CODING_AGENT_DIR: dir,
        PI_ACP_PI_COMMAND: COMMAND,
        GITHUMAN_PI_PROFILE: 'validator'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const exited = once(child, 'exit')
    child.stderr.resume()
    const client = acp
      .client({ name: 'packed-pi-smoke' })
      .onRequest(acp.methods.client.session.requestPermission, ctx => {
        approvals++
        assert.equal(ctx.params.toolCall.name, 'mcp__githuman_artifacts__probe')
        assert.deepEqual(ctx.params.toolCall.rawInput, { value: 5 })
        return {
          outcome: { outcome: 'selected' as const, optionId: 'allow_once' }
        }
      })
      .connect(
        acp.ndJsonStream(
          Writable.toWeb(child.stdin),
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams have equivalent runtime contracts.
          Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
        )
      )
    t.after(async () => {
      client.close()
      child.stdin.end()
      const deadline = setTimeout(() => {
        if (child.pid) void terminateProcesses(child.pid)
      }, 5000)
      try {
        await exited
      } finally {
        clearTimeout(deadline)
        await rm(dir, { recursive: true, force: true })
      }
    })
    await client.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {}
    })
    const session = await client.agent.request(acp.methods.agent.session.new, {
      cwd: dir,
      mcpServers: [
        {
          name: 'githuman_artifacts',
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL(
                '../../server/adapters/pi-acp/fixtures/mcp-server.mjs',
                import.meta.url
              )
            )
          ],
          env: [{ name: 'FIXTURE_CALL_LOG', value: join(dir, 'calls') }]
        }
      ]
    })
    assert.deepEqual(session['_meta']?.githumanBridge, {
      version: 1,
      profile: 'validator',
      registryGeneration: 1
    })
    const response = await client.agent.request(
      acp.methods.agent.session.prompt,
      {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Execute the probe.' }]
      }
    )
    assert.equal(response.stopReason, 'end_turn')
    assert.equal(approvals, 1)
    assert.equal(calls, 2)
    const executed = (await readFile(join(dir, 'calls'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    assert.deepEqual(executed, [{ name: 'probe', arguments: { value: 5 } }])
    assert.ok(JSON.stringify(requests[1]).includes('probe complete'))
  }
)
