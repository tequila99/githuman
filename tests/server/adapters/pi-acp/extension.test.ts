import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { initializePiExtension } from '../../../../src/server/adapters/pi-acp/extension.ts'
import {
  BRIDGE_TIMEOUT_MS,
  JsonChannel,
  MAX_PENDING_CALLS
} from '../../../../src/server/adapters/pi-acp/control.ts'

type ExtensionApi = Parameters<typeof initializePiExtension>[0]
type Tool = Parameters<ExtensionApi['registerTool']>[0]

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const input = new PassThrough()
  const output = new PassThrough()
  const tools = new Map<string, Tool>()
  const handlers = new Map<
    string,
    (event: Record<string, unknown>) => unknown
  >()
  const frames: Record<string, unknown>[] = []
  let exits = 0
  output.on('data', (data: Buffer) => {
    frames.push(JSON.parse(data.toString()))
  })
  t.after(() => {
    input.destroy()
    output.destroy()
  })
  const send = (type: string, fields: Record<string, unknown> = {}) =>
    input.write(
      JSON.stringify({ ...fields, type, nonce: 'test', version: 1 }) + '\n'
    )
  const startup = initializePiExtension(
    {
      registerTool: tool => tools.set(tool.name, tool),
      on: (name, handler) => handlers.set(name, handler),
      getAllTools: () => [],
      setActiveTools: () => {}
    },
    {
      nonce: 'test',
      input,
      output,
      exit: () => {
        exits++
        throw new Error('extension exited')
      }
    }
  )
  send('configure', {
    profile: 'chat',
    instructions: '',
    tools: [
      {
        name: 'mcp__test__probe',
        description: 'probe',
        server: 'test',
        originalName: 'probe',
        inputSchema: { type: 'object' }
      }
    ]
  })
  await startup
  handlers.get('session_start')!({})
  send('begin', { generation: 1 })
  return {
    send,
    frames,
    tool: tools.get('mcp__test__probe')!,
    exits: () => exits
  }
}

test('extension releases the abort listener and deadline after a successful result', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const call = f.tool.execute('success', {}, controller.signal)
  f.send('result', { id: 'success', generation: 1, result: { content: [] } })
  assert.deepEqual(await call, {
    content: [],
    details: { structuredContent: undefined }
  })
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  assert.equal(f.exits(), 0)
})

test('extension timeout releases its listener and accepts one known late result', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const call = f.tool.execute('timeout', {}, controller.signal)
  const rejected = assert.rejects(call, /deadline exceeded/)
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  await rejected
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  f.send('result', { id: 'timeout', generation: 1, result: { content: [] } })
  const next = f.tool.execute('next', {})
  f.send('result', { id: 'next', generation: 1, result: { content: [] } })
  await next
  assert.equal(f.exits(), 0)
})

test('extension observes abort despite stopImmediatePropagation and drops its late result', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  controller.signal.addEventListener(
    'abort',
    event => event.stopImmediatePropagation(),
    { once: true }
  )
  const call = f.tool.execute('abort', {}, controller.signal)
  const rejected = assert.rejects(call, /cancelled/)
  controller.abort()
  await rejected
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  f.send('begin', { generation: 2 })
  f.send('result', { id: 'abort', generation: 1, result: { content: [] } })
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  assert.equal(f.exits(), 0)
})

test('extension control cancellation rejects pending calls and ignores their late results', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const call = f.tool.execute('cancel', {}, controller.signal)
  const rejected = assert.rejects(call, /cancelled/)
  f.send('cancel', { generation: 1 })
  await rejected
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  f.send('result', { id: 'cancel', generation: 1, result: { content: [] } })
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  assert.equal(f.exits(), 0)
})

test('extension send failures release permission slots, listeners and timers', async t => {
  const f = await fixture(t)
  const original = JsonChannel.prototype.send
  t.mock.method(
    JsonChannel.prototype,
    'send',
    function (this: JsonChannel, frame: Parameters<JsonChannel['send']>[0]) {
      if (frame.type === 'call') throw new Error('send failed')
      return original.call(this, frame)
    }
  )
  const controller = new AbortController()
  for (let index = 0; index <= MAX_PENDING_CALLS; index++) {
    await assert.rejects(
      f.tool.execute(String(index), {}, controller.signal),
      /send failed/
    )
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  }
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  assert.equal(f.exits(), 0)
})

test('extension rejects an already aborted signal without sending a call', async t => {
  const f = await fixture(t)
  const before = f.frames.length
  await assert.rejects(
    f.tool.execute('aborted', {}, AbortSignal.abort()),
    /not active/
  )
  assert.equal(f.frames.length, before)
})

for (const scenario of ['unknown', 'duplicate', 'wrong-generation']) {
  test(`extension still terminates for a ${scenario} result`, async t => {
    const f = await fixture(t)
    if (scenario === 'duplicate') {
      const call = f.tool.execute('result', {})
      f.send('result', { id: 'result', generation: 1, result: { content: [] } })
      await call
    }
    assert.throws(
      () =>
        f.send('result', {
          id: 'result',
          generation: scenario === 'wrong-generation' ? 2 : 1,
          result: { content: [] }
        }),
      /extension exited/
    )
    assert.ok(f.exits() > 0)
  })
}

test('extension clears the startup deadline when hello cannot be sent', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const input = new PassThrough()
  const output = new PassThrough()
  t.after(() => {
    input.destroy()
    output.destroy()
  })
  t.mock.method(JsonChannel.prototype, 'send', () => {
    throw new Error('hello failed')
  })
  let exits = 0
  await assert.rejects(
    initializePiExtension(
      {
        registerTool: () => {},
        on: () => {},
        getAllTools: () => [],
        setActiveTools: () => {}
      },
      {
        nonce: 'test',
        input,
        output,
        exit: () => {
          exits++
          throw new Error('unexpected exit')
        }
      }
    ),
    /hello failed/
  )
  t.mock.timers.tick(BRIDGE_TIMEOUT_MS)
  assert.equal(exits, 0)
})
