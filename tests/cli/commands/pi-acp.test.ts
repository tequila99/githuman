import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import * as acp from '@agentclientprotocol/sdk'

// Test the source CLI and optionally repeat against a built or unpacked entry.
const ENTRY =
  process.env.GITHUMAN_PI_SPIKE_ENTRY ??
  fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url))

test('pi ACP CLI rejects extra options without a banner or database startup', () => {
  const result = spawnSync(
    process.execPath,
    [ENTRY, 'pi-acp', '--stdio', '--profile=validator'],
    { encoding: 'utf8', timeout: 10000 }
  )
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Usage: githuman pi-acp --stdio/)
  assert.doesNotMatch(result.stderr, /SQLite/)
})

test(
  'pi ACP capabilities omit restore/history and unsupported methods do not start pi',
  { timeout: 10000 },
  async t => {
    const child = spawn(process.execPath, [ENTRY, 'pi-acp', '--stdio'], {
      env: {
        ...process.env,
        PI_ACP_PI_COMMAND: 'githuman-test-does-not-exist'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.stderr.resume()
    const client = acp.client({ name: 'pi-cli-test' }).connect(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node and DOM streams have equivalent runtime contracts.
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
      )
    )
    t.after(() => {
      client.close()
      child.kill('SIGKILL')
    })
    const initialized = await client.agent.request(
      acp.methods.agent.initialize,
      { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }
    )
    assert.equal(initialized.agentCapabilities?.loadSession, false)
    for (const method of [
      'session/load',
      'session/resume',
      'session/list',
      'session/delete',
      'session/fork'
    ]) {
      await assert.rejects(
        client.agent.request(method, {
          sessionId: 'foreign',
          cwd: process.cwd(),
          mcpServers: []
        })
      )
    }
    await assert.rejects(
      client.agent.request(acp.methods.agent.session.prompt, {
        sessionId: 'foreign',
        prompt: [{ type: 'text', text: 'test' }]
      })
    )
    await assert.rejects(
      client.agent.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: []
      })
    )
    await assert.rejects(
      client.agent.request(acp.methods.agent.session.new, {
        cwd: process.cwd(),
        mcpServers: []
      }),
      /One pi bridge process/
    )
  }
)
