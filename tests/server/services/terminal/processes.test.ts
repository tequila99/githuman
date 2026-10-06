import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  descendants,
  processes,
  signalProcess,
  terminateProcesses,
  type ProcessRow
} from '../../../../src/server/services/terminal/processes.ts'

const row = (pid: number, parent: number, group = pid): ProcessRow => ({
  pid,
  parent,
  group
})
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function waitUntil(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await sleep(50)
  }
  assert.fail('condition was not met in time')
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('descendants lists the root first and each parent before its children', () => {
  const rows = [row(30, 20), row(20, 10), row(10, 1), row(40, 10), row(50, 2)]
  assert.deepEqual(
    descendants(rows, 10).map(item => item.pid),
    [10, 20, 40, 30]
  )
})

test('descendants ignores unrelated processes and survives a self-parent loop', () => {
  assert.deepEqual(descendants([row(5, 5), row(6, 1)], 5), [row(5, 5)])
  assert.deepEqual(descendants([row(6, 1)], 99), [])
})

test('descendants finds children of a root that left the list', () => {
  assert.deepEqual(descendants([row(7, 99)], 99), [row(7, 99)])
})

test('signalProcess ignores PIDs that would reach the server group or every process', () => {
  for (const pid of [0, 1, -1, Number.NaN, 1.5]) signalProcess(pid, 'SIGKILL')
  assert.ok(alive(process.pid))
})

test('terminateProcesses ignores unsafe PIDs', async () => {
  for (const pid of [0, 1, -1, Number.NaN]) await terminateProcesses(pid)
  assert.ok(alive(process.pid))
})

test('terminateProcesses kills a whole tree, including processes that ignore SIGHUP', async t => {
  // The trap makes the shell and its children ignore SIGHUP: only SIGKILL stops them.
  const shell = spawn('sh', ['-c', "trap '' HUP; sleep 60 & sleep 60 & wait"], {
    detached: true,
    stdio: 'ignore'
  })
  t.after(() => {
    if (shell.pid) signalProcess(-shell.pid, 'SIGKILL')
  })
  const exited = new Promise(resolve => shell.once('exit', resolve))
  const pid = shell.pid ?? 0
  let children: number[] = []
  await waitUntil(async () => {
    children = descendants(await processes(), pid)
      .map(item => item.pid)
      .filter(id => id !== pid)
    return children.length === 2
  })
  await terminateProcesses(pid)
  await exited
  await waitUntil(() => children.every(id => !alive(id)))
})
