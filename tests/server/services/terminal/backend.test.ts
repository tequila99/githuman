import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadPty,
  NodePtyBackend,
  PipeBackend
} from '../../../../src/server/services/terminal/backend.ts'
import type { PtyBackend } from '../../../../src/server/services/terminal/backend.ts'

async function waitFor(
  backend: PtyBackend,
  command: string,
  expected: RegExp
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = ''
    // oxlint-disable-next-line prefer-const -- the timeout closure captures disposal before registration
    let dispose: (() => void) | undefined
    const timeout = setTimeout(() => {
      dispose?.()
      reject(new Error(`Output timeout: ${output}`))
    }, 4000)
    dispose = backend.onData(data => {
      output += data
      if (expected.test(output)) {
        clearTimeout(timeout)
        dispose?.()
        resolve(output)
      }
    })
    backend.write(command)
  })
}

test('real PTY provides tty, resize, interrupt, and process cleanup', async t => {
  const module = await loadPty()
  if (!module) {
    assert.ok(!process.env.CI, 'Linux CI must load a real PTY')
    t.skip('Platform binary unavailable')
    return
  }
  const backend = new NodePtyBackend(
    module.spawn('/bin/sh', ['-i'], {
      cwd: '/tmp',
      cols: 93,
      rows: 29,
      env: { ...process.env, TERM: 'xterm-256color' }
    })
  )
  t.after(() => backend.kill())
  await waitFor(backend, 'tty; stty size\r', /29 93/)
  backend.resize(111, 31)
  await waitFor(backend, 'stty size\r', /31 111/)
  backend.write('/usr/bin/sleep 60\r')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await backend.activity(), 'running')
  backend.interrupt()
  await waitFor(backend, 'printf "AFTER_%s\\n" INTERRUPT\r', /AFTER_INTERRUPT/)
  await backend.kill()
  assert.throws(() => process.kill(backend.pid, 0))
})

test('pipe keeps cwd and shell alive after interrupt', async t => {
  const backend = new PipeBackend('/tmp')
  t.after(() => backend.kill())
  await waitFor(backend, 'cd /; printf "PIPE_%s\\n" READY\n', /PIPE_READY/)
  backend.write('/usr/bin/sleep 60\n')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(await backend.activity(), 'running')
  backend.interrupt()
  await waitFor(
    backend,
    'printf "AFTER_%s\\n" INTERRUPT; pwd\n',
    /AFTER_INTERRUPT/
  )
  await backend.kill()
  assert.throws(() => process.kill(backend.pid, 0))
})

test('prompt integration confirms idle but does not mistake a shell builtin loop for idle', async t => {
  const module = await loadPty()
  assert.ok(module)
  const backend = new NodePtyBackend(
    module.spawn('/bin/sh', ['-i'], {
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' }
    }),
    'sh'
  )
  t.after(() => backend.kill())
  await waitFor(backend, 'printf "PROMPT_%s\\n" READY\r', /PROMPT_READY/)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(await backend.activity(), 'idle')
  backend.write('while :; do :; done\r')
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(await backend.activity(), 'unknown')
  backend.interrupt()
  await waitFor(backend, 'printf "LOOP_%s\\n" STOPPED\r', /LOOP_STOPPED/)
})
