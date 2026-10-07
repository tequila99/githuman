import { test } from 'node:test'
import assert from 'node:assert/strict'
import headless from '@xterm/headless'
import { TerminalSession } from '../../../../src/server/services/terminal/session.ts'
import type { TerminalServerMessage } from '../../../../src/shared/terminal/types.ts'
import { FakeBackend } from './fake-backend.ts'

test('resize boundaries keep normal and alternate screen output in server order', async t => {
  const backend = new FakeBackend()
  const messages: TerminalServerMessage[] = []
  const session = new TerminalSession(
    'one',
    'Terminal',
    backend,
    20,
    6,
    message => messages.push(message),
    () => {}
  )
  const viewer = new headless.Terminal({
    cols: 20,
    rows: 6,
    allowProposedApi: true
  })
  t.after(async () => {
    viewer.dispose()
    await session.dispose()
  })

  backend.data('abcdefghijklmnopqrstuv\r\n')
  await session.resize(40, 10)
  backend.data('\x1b[?1049h\x1b[2J\x1b[1;35Hright\x1b[10;1Hbottom')
  await session.resize(25, 8)
  backend.data('\x1b[2J\x1b[1;20Hright\x1b[8;1Hbottom')
  let snapshot: Extract<TerminalServerMessage, { type: 'snapshot' }> | undefined
  await session.snapshot(message => {
    if (message.type === 'snapshot') snapshot = message
  })

  const output = messages.filter(message => message.type === 'output')
  assert.deepEqual(
    output.map(message => [message.cols, message.rows, message.data === '']),
    [
      [20, 6, false],
      [40, 10, true],
      [40, 10, false],
      [25, 8, true],
      [25, 8, false]
    ]
  )
  assert.deepEqual(
    output.map(message => message.sequence),
    [1, 2, 3, 4, 5]
  )
  for (const message of output) {
    viewer.resize(message.cols, message.rows)
    await new Promise<void>(resolve => viewer.write(message.data, resolve))
  }
  assert.equal(viewer.buffer.active.type, 'alternate')
  assert.equal(
    viewer.buffer.active.getLine(0)?.translateToString(true),
    '                   right'
  )
  assert.equal(
    viewer.buffer.active.getLine(7)?.translateToString(true),
    'bottom'
  )
  assert.equal(snapshot?.cols, viewer.cols)
  assert.equal(snapshot?.rows, viewer.rows)
  assert.equal(snapshot?.sequence, 5)

  backend.data('\x1b[?1049l\r\nback to shell')
  await session.snapshot(() => {})
  const last = messages.at(-1)
  assert.ok(last?.type === 'output')
  viewer.resize(last.cols, last.rows)
  await new Promise<void>(resolve => viewer.write(last.data, resolve))
  assert.equal(viewer.buffer.active.type, 'normal')
})
