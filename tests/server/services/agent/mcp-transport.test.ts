import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { AgentSession } from '../../../../src/server/services/agent/agent-session.ts'

test(
  'ACP v1 stdio configuration completes MCP initialize, list, create and get',
  { timeout: 15_000 },
  async t => {
    const fixtures = join(import.meta.dirname, '../../fixtures')
    const session = new AgentSession({
      name: 'MCP probe',
      cwd: process.cwd(),
      preset: {
        id: 'fake-mcp',
        title: 'Fake MCP',
        command: process.execPath,
        args: [join(fixtures, 'fake-acp-mcp-agent.ts')],
        autoApprovesEdits: false
      },
      mcpServers: [
        {
          name: 'artifacts',
          command: process.execPath,
          args: [join(fixtures, 'artifact-mcp-probe.ts')],
          env: []
        }
      ]
    })
    t.after(() => session.close())
    await session.start()
    assert.equal(session.status, 'ready', session.info().error ?? undefined)
    session.close()
    await delay(50)
  }
)
