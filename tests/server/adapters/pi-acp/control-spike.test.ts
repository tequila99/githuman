import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

// Real runtime checks are opt-in and never use the user's model configuration.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND
// Each fixture must terminate within the process-test deadline.
const TEST_TIMEOUT_MS = 20000
// Prevent malformed control output from exhausting the test process.
const MAX_OUTPUT_BYTES = 65536

interface Identity {
  fd: number
  dev?: number
  ino?: number
  closed?: boolean
}
interface Probe {
  noncePresent: boolean
  fds: Identity[]
}
interface Frame {
  type: string
  version: number
  nonce: string
  channels?: Identity[]
  child?: Probe
  inherited?: Probe
  result?: { content: { type: string; text?: string }[]; isError: boolean }
}

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'githuman-control-spike-'))
  const nonce = randomBytes(32).toString('hex')
  let command = ''
  let modelCalls = 0
  const model = createServer(async (req, res) => {
    req.resume()
    const tool = modelCalls++ === 0
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'fd_probe',
              type: 'function',
              function: { name: 'bash', arguments: JSON.stringify({ command }) }
            }
          ]
        }
      : { role: 'assistant', content: 'done' }
    for (const [value, finish] of [
      [delta, null],
      [{}, tool ? 'tool_calls' : 'stop']
    ]) {
      res.write(
        `data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`
      )
    }
    res.end('data: [DONE]\n\n')
  })
  t.after(() => {
    model.closeAllConnections()
    model.close()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  const address = model.address()
  assert.ok(address && typeof address !== 'string')
  await writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'probe', defaultModel: 'probe' })
  )
  await writeFile(
    join(dir, 'models.json'),
    JSON.stringify({
      providers: {
        probe: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions',
          apiKey: 'local-fixture',
          models: [
            {
              id: 'probe',
              name: 'probe',
              reasoning: false,
              input: ['text'],
              contextWindow: 32000,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }
          ]
        }
      }
    })
  )
  const child = spawn(
    COMMAND ?? 'pi',
    [
      '--mode',
      'rpc',
      '--no-session',
      '--no-extensions',
      '-e',
      fileURLToPath(
        new URL('./fixtures/control-extension.mjs', import.meta.url)
      )
    ],
    {
      cwd: dir,
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        PI_CODING_AGENT_DIR: dir,
        GITHUMAN_SPIKE_NONCE: nonce
      },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe']
    }
  )
  const exited = once(child, 'exit')
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.write(JSON.stringify({ type: 'abort' }) + '\n')
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 250))
      ])
    }
    const marker = await readFile(join(dir, 'bash.pid'), 'utf8').catch(() => '')
    const bashPid = Number(marker)
    if (Number.isSafeInteger(bashPid) && bashPid > 1) killGroup(bashPid)
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      killGroup(child.pid)
    }
    await exited
    await rm(dir, { recursive: true, force: true })
  }
  t.after(cleanup)
  const frames: Frame[] = []
  const rpc: Record<string, unknown>[] = []
  let bytes = 0
  const read = (input: NodeJS.ReadableStream, values: unknown[]) => {
    input.on('data', chunk => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_OUTPUT_BYTES) child.kill('SIGKILL')
    })
    createInterface({ input }).on('line', line => {
      try {
        values.push(JSON.parse(line))
      } catch {
        child.kill('SIGKILL')
      }
    })
  }
  read(child.stdio[3] as Socket, frames)
  read(child.stdout, rpc)
  child.stderr.resume()
  const waitFor = async <T>(
    values: T[],
    predicate: (value: T) => boolean
  ): Promise<T> => {
    for (let i = 0; i < 1000; i++) {
      const found = values.find(predicate)
      if (found) return found
      assert.equal(child.exitCode, null, 'pi exited before the expected frame')
      assert.equal(
        child.signalCode,
        null,
        'pi was killed before the expected frame'
      )
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return assert.fail('Expected frame was not received within 10 seconds')
  }
  const hello = await waitFor(frames, value => value.type === 'hello')
  assert.equal(hello.version, 1)
  assert.equal(hello.nonce, nonce)
  return {
    child,
    cleanup,
    exited,
    frames,
    rpc,
    nonce,
    waitFor,
    dir,
    ack: (value: unknown) =>
      (child.stdio[4] as Socket).write(JSON.stringify(value) + '\n'),
    setCommand: (value: string) => {
      command = value
    },
    modelCalls: () => modelCalls
  }
}

function killGroup(pid: number) {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function assertIsolated(channels: Identity[], probe: Probe) {
  assert.equal(probe.noncePresent, false)
  for (const fd of probe.fds) {
    assert.ok(
      !channels.some(
        channel =>
          !fd.closed && channel.dev === fd.dev && channel.ino === fd.ino
      ),
      'A child inherited a control channel'
    )
  }
}

test(
  'pi control spike: native bash and child processes cannot access control channels',
  { skip: !COMMAND, timeout: TEST_TIMEOUT_MS },
  async t => {
    const f = await fixture(t)
    f.ack({ type: 'hello_ack', version: 1, nonce: f.nonce })
    const ready = await f.waitFor(f.frames, value => value.type === 'ready')
    assert.equal(ready.nonce, f.nonce)
    assertIsolated(ready.channels!, ready.child!)
    assert.throws(
      () => assertIsolated(ready.channels!, ready.inherited!),
      /inherited a control channel/
    )
    const probePath = fileURLToPath(
      new URL('./fixtures/descriptor-probe.mjs', import.meta.url)
    )
    f.setCommand(
      `printf '%s' "$$" > ${quote(join(f.dir, 'bash.pid'))}; for path in /dev/fd/*; do fd=\${path##*/}; if { : <&"$fd"; } 2>/dev/null; then ${quote(process.execPath)} ${quote(probePath)} "$fd" ${quote(JSON.stringify(ready.channels))} <&"$fd"; fi; done`
    )
    f.child.stdin.write(
      JSON.stringify({ type: 'prompt', message: 'Execute the bash probe.' }) +
        '\n'
    )
    const result = await f.waitFor(
      f.frames,
      value => value.type === 'bash_result'
    )
    assert.equal(result.result!.isError, false)
    const output = result.result!.content.find(
      value => value.type === 'text'
    )!.text!
    const probes: Probe[] = output
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    assert.ok(
      probes.length >= 3,
      'bash must enumerate at least stdin, stdout, and stderr'
    )
    for (const probe of probes) assertIsolated(ready.channels!, probe)
    await f.waitFor(f.rpc, value => value.type === 'agent_end')
    assert.equal(f.modelCalls(), 2)
    ;(f.child.stdio[4] as Socket).end()
    const [code, signal] = await f.exited
    assert.equal(signal, null)
    assert.equal(code, 0)
  }
)

for (const invalid of ['wrong', 'missing']) {
  test(
    `pi control spike: ${invalid} nonce terminates before ready`,
    { skip: !COMMAND, timeout: TEST_TIMEOUT_MS },
    async t => {
      const f = await fixture(t)
      f.ack({
        type: 'hello_ack',
        version: 1,
        ...(invalid === 'wrong' ? { nonce: 'wrong' } : {})
      })
      const [code, signal] = await f.exited
      assert.equal(signal, null)
      assert.equal(code, 73)
      assert.equal(
        f.frames.some(value => value.type === 'ready'),
        false
      )
      assert.equal(f.modelCalls(), 0)
    }
  )
}

for (const scenario of ['eof', 'timeout', 'malformed', 'oversized']) {
  test(
    `pi control spike: ${scenario} before ready terminates startup`,
    { skip: !COMMAND, timeout: TEST_TIMEOUT_MS },
    async t => {
      const f = await fixture(t)
      const pipe = f.child.stdio[4] as Socket
      if (scenario === 'eof') {
        pipe.end()
      } else if (scenario === 'malformed') {
        pipe.write('not-json\n')
      } else if (scenario === 'oversized') {
        pipe.write('x'.repeat(4097))
      }
      const [code, signal] = await f.exited
      assert.equal(signal, null)
      assert.equal(
        code,
        { eof: 0, timeout: 74, malformed: 73, oversized: 75 }[scenario]
      )
      assert.equal(
        f.frames.some(value => value.type === 'ready'),
        false
      )
      assert.equal(f.modelCalls(), 0)
    }
  )
}

test(
  'pi control spike: cleanup stops an active detached bash group',
  { skip: !COMMAND, timeout: TEST_TIMEOUT_MS },
  async t => {
    const f = await fixture(t)
    f.ack({ type: 'hello_ack', version: 1, nonce: f.nonce })
    await f.waitFor(f.frames, frame => frame.type === 'ready')
    f.setCommand(
      `printf '%s' "$$" > ${quote(join(f.dir, 'bash.pid'))}; exec sleep 60`
    )
    f.child.stdin.write(
      JSON.stringify({ type: 'prompt', message: 'Execute the bash probe.' }) +
        '\n'
    )
    let pid = 0
    for (let i = 0; i < 500; i++) {
      pid = Number(
        await readFile(join(f.dir, 'bash.pid'), 'utf8').catch(() => '')
      )
      if (pid > 1) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(pid > 1, 'bash did not write its process group marker')
    await f.cleanup()
    assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' })
    assert.notEqual(f.child.exitCode ?? f.child.signalCode, null)
  }
)
