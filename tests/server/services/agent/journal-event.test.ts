import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  JournalEventBuffer,
  journalEventText
} from '../../../../src/server/services/agent/journal-event.ts'
import { MAX_JOURNAL_ENTRY_BYTES } from '../../../../src/shared/task-journal/constants.ts'

test('journal preserves tool details and redacts nested credentials', () => {
  const value = JSON.parse(
    journalEventText({
      type: 'tool_input',
      toolCallId: 't1',
      input: {
        command: 'python3 example.py',
        headers: { Authorization: 'Bearer hidden' },
        api_key: 'hidden'
      }
    })
  )
  assert.equal(value.input.command, 'python3 example.py')
  assert.equal(value.toolCallId, 't1')
  assert.equal(value.input.headers.Authorization, '[redacted]')
  assert.equal(value.input.api_key, '[redacted]')
})

test('journal bounds Unicode output and signals loss', () => {
  const text = journalEventText({ output: '😀'.repeat(20000) })
  assert.ok(Buffer.byteLength(text) <= MAX_JOURNAL_ENTRY_BYTES)
  assert.ok(text.endsWith('[truncated]'))
  assert.ok(!text.includes('\ufffd'))
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.ok(journalEventText(cyclic).includes('[truncated]'))
})

test('journal joins message chunks and preserves roles and tool boundaries', () => {
  const rows: { event: unknown; id: number }[] = []
  const buffer = new JournalEventBuffer((event, id) => rows.push({ event, id }))
  buffer.push({ type: 'message', role: 'thought', text: 'Let ' }, 1)
  buffer.push({ type: 'message', role: 'thought', text: 'me think' }, 2)
  buffer.push({ type: 'message', role: 'agent', text: 'Checking' }, 3)
  buffer.push({ type: 'message', role: 'agent', text: ' files' }, 4)
  buffer.push({ type: 'tool', toolCallId: 't1', status: 'completed' }, 5)
  buffer.push({ type: 'message', role: 'agent', text: 'Done' }, 6)
  buffer.push({ type: 'stop', stopReason: 'end_turn' }, 7)
  buffer.flush()
  assert.deepEqual(rows, [
    {
      id: 1,
      event: { type: 'message', role: 'thought', text: 'Let me think' }
    },
    {
      id: 3,
      event: { type: 'message', role: 'agent', text: 'Checking files' }
    },
    { id: 5, event: { type: 'tool', toolCallId: 't1', status: 'completed' } },
    { id: 6, event: { type: 'message', role: 'agent', text: 'Done' } },
    { id: 7, event: { type: 'stop', stopReason: 'end_turn' } }
  ])
})

for (const outcome of ['cancelled', 'failed'] as const) {
  test(`journal retains the unfinished message on ${outcome}`, () => {
    const rows: unknown[] = []
    const buffer = new JournalEventBuffer(event => rows.push(event))
    buffer.push({ type: 'message', role: 'agent', text: 'Partial ' }, 1)
    buffer.push({ type: 'message', role: 'agent', text: 'reply' }, 2)
    buffer.flush(outcome)
    buffer.flush(outcome)
    buffer.push({ type: 'message', role: 'agent', text: 'Next turn' }, 3)
    buffer.flush()
    assert.deepEqual(rows, [
      {
        type: 'message',
        role: 'agent',
        text: 'Partial reply',
        incomplete: outcome
      },
      { type: 'message', role: 'agent', text: 'Next turn' }
    ])
  })
}

test('journal flushes pending text before permission events and errors', () => {
  const rows: unknown[] = []
  const buffer = new JournalEventBuffer(event => rows.push(event))
  buffer.push({ type: 'message', role: 'agent', text: 'Before permission' }, 1)
  buffer.push({ type: 'permission_answer', allowed: true }, 2)
  buffer.push({ type: 'message', role: 'agent', text: 'Before error' }, 3)
  buffer.push({ type: 'error', message: 'Disconnected' }, 4, 'failed')
  assert.deepEqual(rows, [
    { type: 'message', role: 'agent', text: 'Before permission' },
    { type: 'permission_answer', allowed: true },
    {
      type: 'message',
      role: 'agent',
      text: 'Before error',
      incomplete: 'failed'
    },
    { type: 'error', message: 'Disconnected' }
  ])
})

test('journal bounds a streamed message without creating token rows', () => {
  const rows: { text: string; truncated?: boolean }[] = []
  const buffer = new JournalEventBuffer(event =>
    rows.push(event as (typeof rows)[number])
  )
  for (let i = 0; i < 10000; i++) {
    buffer.push({ type: 'message', role: 'agent', text: '😀' }, i)
  }
  buffer.flush()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].truncated, true)
  assert.ok(Buffer.byteLength(rows[0].text) <= MAX_JOURNAL_ENTRY_BYTES)
  assert.ok(!rows[0].text.includes('\ufffd'))
})
