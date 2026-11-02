import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localModel } from './fixtures/model-server.ts'
import { PiSession } from '../../../../src/server/adapters/pi-acp/session.ts'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

// Run real pi only on explicit request; ordinary unit tests do not need a runtime.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND

for (const scenario of ['allow', 'deny', 'cancel', 'native-deny']) {
  test(
    `local pi bridge: ${scenario}`,
    { skip: !COMMAND, timeout: 25000 },
    async t => {
      const dir = await mkdtemp(join(tmpdir(), 'githuman-pi-session-'))
      const previous = { ...process.env }
      const permissions: RequestPermissionRequest[] = []
      let calls = 0
      const requests = await localModel(t, dir, () => {
        if (calls++ > 0) return null
        return {
          name:
            scenario === 'native-deny'
              ? 'write'
              : 'mcp__githuman_artifacts__probe',
          arguments:
            scenario === 'native-deny'
              ? { path: join(dir, 'forbidden'), content: 'forbidden' }
              : { value: 7 }
        }
      })
      const marker = join(dir, 'foreign-startup')
      await mkdir(join(dir, '.pi', 'extensions'), { recursive: true })
      await mkdir(join(dir, 'extensions'), { recursive: true })
      const foreign = `import {writeFileSync} from 'node:fs'; export default function(pi){writeFileSync(${JSON.stringify(marker)},'startup');pi.on('tool_call',()=>{throw Error('foreign hook')});}`
      await writeFile(
        join(dir, '.pi', 'extensions', 'foreign.ts'),
        foreign.replaceAll(marker, marker + '-project')
      )
      await writeFile(
        join(dir, 'extensions', 'foreign.ts'),
        foreign.replaceAll(marker, marker + '-global')
      )
      await writeFile(join(dir, 'explicit.mjs'), foreign)
      await mkdir(join(dir, 'fixture-package'))
      await writeFile(
        join(dir, 'fixture-package', 'package.json'),
        JSON.stringify({
          name: 'pi-isolation-fixture',
          version: '1.0.0',
          pi: { extensions: ['extension.ts'] }
        })
      )
      await writeFile(
        join(dir, 'fixture-package', 'extension.ts'),
        foreign.replaceAll(marker, marker + '-package')
      )
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
          defaultProvider: 'probe',
          defaultModel: 'probe',
          extensions: [join(dir, 'explicit.mjs')],
          packages: [join(dir, 'fixture-package')]
        })
      )
      process.env.PI_ACP_PI_COMMAND = COMMAND
      process.env.PI_CODING_AGENT_DIR = dir
      process.env.HOME = dir
      const log = join(dir, 'mcp-calls')
      const session = new PiSession('validator', {
        update: async () => {},
        permission: async request => {
          permissions.push(structuredClone(request))
          if (scenario === 'cancel') await session.cancel()
          return {
            outcome: {
              outcome: 'selected',
              optionId: scenario === 'deny' ? 'reject_once' : 'allow_once'
            }
          }
        },
        failure: () => {}
      })
      t.after(async () => {
        session.close()
        for (const key of Object.keys(process.env)) {
          if (!(key in previous)) delete process.env[key]
        }
        Object.assign(process.env, previous)
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100
        })
      })
      await session.start(dir, [
        {
          name: 'githuman_artifacts',
          command: process.execPath,
          args: [
            fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))
          ],
          env: [{ name: 'FIXTURE_CALL_LOG', value: log }]
        }
      ])
      for (const suffix of ['', '-global', '-project', '-package']) {
        await assert.rejects(readFile(marker + suffix), { code: 'ENOENT' })
      }
      assert.throws(() => session.assertSession('foreign'), /Unknown/)
      assert.ok(session.config.some(option => option.id === 'thought_level'))
      assert.ok(session.config.some(option => option.id === 'model'))
      await session.setConfig('thought_level', 'off')
      await session.setConfig('model', 'probe/probe-thinking')
      const thinkingOption = session.config.find(
        option => option.id === 'thought_level'
      )
      assert.ok(
        thinkingOption?.type === 'select' && thinkingOption.options.length > 1
      )
      await session.setConfig('model', 'probe/probe')
      const normalOption = session.config.find(
        option => option.id === 'thought_level'
      )
      assert.ok(
        normalOption?.type === 'select' && normalOption.options.length === 1
      )
      await assert.rejects(
        session.setConfig('thought_level', 'foreign'),
        /Unknown/
      )
      await assert.rejects(session.setConfig('foreign', 'off'), /Unknown/)
      const result = await session.prompt([
        { type: 'text', text: 'Execute the fixture tool.' }
      ])
      assert.equal(
        result.stopReason,
        scenario === 'cancel' ? 'cancelled' : 'end_turn'
      )
      assert.ok(
        JSON.stringify(requests[0]).includes(
          'GITHUMAN_FIXTURE_INSTRUCTIONS_BEFORE_FIRST_PROMPT'
        )
      )
      assert.ok(JSON.stringify(requests[0]).includes('tasks_get_context'))
      if (scenario === 'allow') {
        const executed = (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
        assert.equal(executed.length, 1)
        assert.deepEqual(executed[0].arguments, { value: 7 })
      } else {
        await assert.rejects(readFile(log), { code: 'ENOENT' })
      }
      assert.equal(permissions.length, scenario === 'native-deny' ? 0 : 1)
      await assert.rejects(readFile(join(dir, 'forbidden')), { code: 'ENOENT' })
    }
  )
}

for (const collision of [false, true]) {
  test(
    `pi chat custom commands and MCP collision=${collision}`,
    { skip: !COMMAND, timeout: 20000 },
    async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pi-chat-compat-'))
      const previous = { ...process.env }
      const requests = await localModel(t, dir, () => null)
      const marker = join(dir, 'called')
      const extension = join(dir, 'custom.ts')
      await writeFile(
        extension,
        `import { writeFileSync } from 'node:fs'; export default function(pi) { ${collision ? "pi.registerTool({name:'mcp__githuman_artifacts__probe',label:'collision',description:'collision',parameters:{type:'object',properties:{}},execute:async()=>({content:[]})})" : `pi.registerCommand('noop',{description:'fixture',handler:async()=>{writeFileSync(${JSON.stringify(marker)},'done')}})`} }`
      )
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
          defaultProvider: 'probe',
          defaultModel: 'probe',
          extensions: [extension]
        })
      )
      process.env.PI_ACP_PI_COMMAND = COMMAND
      process.env.HOME = dir
      process.env.PI_CODING_AGENT_DIR = dir
      const session = new PiSession('chat', {
        update: async () => {},
        permission: async () => ({ outcome: { outcome: 'cancelled' } }),
        failure: () => {}
      })
      t.after(async () => {
        session.close()
        for (const key of Object.keys(process.env)) {
          if (!(key in previous)) delete process.env[key]
        }
        Object.assign(process.env, previous)
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100
        })
      })
      const start = () =>
        session.start(dir, [
          {
            name: 'githuman_artifacts',
            command: process.execPath,
            args: [
              fileURLToPath(
                new URL('./fixtures/mcp-server.mjs', import.meta.url)
              )
            ],
            env: [{ name: 'FIXTURE_CALL_LOG', value: join(dir, 'calls') }]
          }
        ])
      if (collision) {
        await assert.rejects(start(), /collision/)
        return
      }
      await start()
      const response = await session.prompt([{ type: 'text', text: '/noop' }])
      assert.equal(response.stopReason, 'end_turn')
      assert.equal(await readFile(marker, 'utf8'), 'done')
      assert.equal(requests.length, 0)
    }
  )
}
