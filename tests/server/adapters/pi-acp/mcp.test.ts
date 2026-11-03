import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpRegistry } from '../../../../src/server/adapters/pi-acp/mcp.ts'

test('MCP registry validates and snapshots arguments before calling the original tool', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-mcp-registry-'))
  const registry = new McpRegistry()
  t.after(async () => {
    await registry.close()
    await rm(dir, { recursive: true, force: true })
  })
  const log = join(dir, 'calls')
  await registry.connect([
    {
      name: 'githuman_artifacts',
      command: process.execPath,
      args: [
        fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))
      ],
      env: [{ name: 'FIXTURE_CALL_LOG', value: log }]
    }
  ])
  assert.equal(registry.tools.length, 1)
  assert.ok(registry.instructions.includes('INSTRUCTIONS'))
  const input = { value: 1 }
  const call = registry.snapshot('mcp__githuman_artifacts__probe', input)
  input.value = 2
  assert.throws(
    () => registry.snapshot('mcp__githuman_artifacts__probe', { value: 1.5 }),
    /schema/
  )
  assert.throws(
    () => registry.snapshot('mcp__other__probe', { value: 1 }),
    /Unknown/
  )
  await registry.call(
    call.descriptor.name,
    call.arguments,
    new AbortController().signal
  )
  assert.deepEqual(JSON.parse((await readFile(log, 'utf8')).trim()), {
    name: 'probe',
    arguments: { value: 1 }
  })
  await assert.rejects(
    registry.call(call.descriptor.name, call.arguments, AbortSignal.abort()),
    /no longer active/
  )
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1)
})

test('MCP registry rejects non-stdio and duplicate server identities before tool discovery', async () => {
  const registry = new McpRegistry()
  await assert.rejects(
    registry.connect([
      { type: 'http', name: 'foreign', url: 'http://127.0.0.1', headers: [] }
    ]),
    /stdio/
  )
})
