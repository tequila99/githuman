import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  actorLabel,
  factDetail,
  supersededIds,
  journalMessage,
  journalSummary,
  journalIcon
} from '@/utils/task-journal'
import type { JournalEntry } from '../../../src/web/api/types.ts'

// Chat names that the agent store would resolve.
const names = (id: string) => (id === 'chat' ? 'Codex' : undefined)

function entry(extra: Partial<JournalEntry>): JournalEntry {
  return {
    id: 'e',
    seq: 1,
    storeId: 's',
    taskId: 't',
    kind: 'note',
    eventType: null,
    body: 'text',
    actor: { kind: 'user', id: 'local' },
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: '2026-11-12T00:00:00Z',
    ...extra
  }
}

test('fact detail removes the legacy event prefix', () => {
  const fact = {
    kind: 'system' as const,
    eventType: 'handoff_completed' as const
  }
  assert.equal(
    factDetail(entry({ ...fact, body: 'handoff_completed: A → B' })),
    'A → B'
  )
  assert.equal(factDetail(entry({ ...fact, body: 'A → B' })), 'A → B')
  assert.equal(
    factDetail(
      entry({
        kind: 'system',
        eventType: 'turn_finished',
        body: 'turn_finished'
      })
    ),
    ''
  )
})

test('superseded ids and author labels', () => {
  assert.deepEqual(
    [
      ...supersededIds([
        entry({ id: 'b', supersedesEntryId: 'a' }),
        entry({ id: 'a' })
      ])
    ],
    ['a']
  )
  assert.equal(
    actorLabel(entry({ actor: { kind: 'system', id: 'server' } }), names).key,
    'journal.actors.server'
  )
  assert.deepEqual(
    actorLabel(entry({ actor: { kind: 'agent', id: 'chat' } }), names),
    {
      key: 'journal.actors.agentNamed',
      params: { name: 'Codex' }
    }
  )
  assert.equal(
    actorLabel(entry({ actor: { kind: 'user', id: 'device-1' } }), names).key,
    'journal.actors.device'
  )
})

test('message previews remove Markdown before clipping while details keep the complete source', () => {
  const text =
    '**Recommendation**: use `QExpansionItem`.\n\n' + 'More text. '.repeat(40)
  const message = entry({
    kind: 'system',
    eventType: 'agent_event',
    body: JSON.stringify({ type: 'message', role: 'agent', text })
  })
  const summary = journalSummary(message)
  assert.ok(
    summary.startsWith('message · agent · Recommendation: use QExpansionItem.')
  )
  assert.equal(summary.length, 241)
  assert.ok(summary.endsWith('…'))
  assert.deepEqual(journalMessage(message), {
    role: 'agent',
    text,
    truncated: false
  })
  assert.equal(
    journalSummary(entry({ body: '[Plan](https://example.com) **ready**' })),
    'Plan ready'
  )
  assert.equal(
    journalSummary(
      entry({
        eventType: 'turn_finished',
        context: {
          response: '**Finished**',
          prompt: '',
          presetId: 'test',
          agentName: 'Codex',
          sessionName: 'Closed chat',
          model: null,
          reasoning: null,
          settings: [],
          promptTruncated: false,
          responseTruncated: false
        }
      })
    ),
    'Finished'
  )
})

test('message detection handles thoughts, empty text and truncation without interpreting tool JSON', () => {
  const makeEvent = (value: unknown) =>
    entry({ eventType: 'agent_event', body: JSON.stringify(value) })
  assert.deepEqual(
    journalMessage(
      makeEvent({ type: 'message', role: 'thought', text: '', truncated: true })
    ),
    {
      role: 'thought',
      text: '',
      truncated: true
    }
  )
  for (const value of [
    null,
    [],
    { type: 'message', role: 'agent', text: 42 },
    { type: 'request', text: '**input**' },
    { type: 'tool_result', text: '**raw**', output: { result: '**raw**' } }
  ]) {
    assert.equal(journalMessage(makeEvent(value)), null)
  }
  assert.equal(
    journalSummary(makeEvent({ type: 'tool_result', text: '**raw**' })),
    'tool_result · **raw**'
  )
  const broken = entry({
    eventType: 'agent_event',
    body: '{"type":"message","text":"**cut\n[truncated]'
  })
  assert.equal(journalMessage(broken), null)
  assert.equal(journalSummary(broken), broken.body.replace(/\s+/g, ' '))
  assert.equal(
    journalMessage(
      entry({ body: '{"type":"message","role":"agent","text":"hello"}' })
    ),
    null
  )
})

test('journal icons distinguish categories, response outcomes and message roles', () => {
  const icon = (extra: Partial<JournalEntry>) => journalIcon(entry(extra))
  assert.notEqual(icon({ kind: 'note' }), icon({ kind: 'decision' }))
  assert.notEqual(
    icon({ eventType: 'turn_finished' }),
    icon({ eventType: 'turn_failed' })
  )
  assert.notEqual(
    icon({ eventType: 'turn_failed' }),
    icon({ eventType: 'turn_cancelled' })
  )
  const message = {
    eventType: 'agent_event' as const,
    body: JSON.stringify({ type: 'message', role: 'agent', text: 'hello' })
  }
  const thought = {
    ...message,
    body: JSON.stringify({ type: 'message', role: 'thought', text: 'thinking' })
  }
  assert.notEqual(icon(message), icon(thought))
  assert.notEqual(icon(message), icon({ eventType: 'agent_event', body: '{}' }))
  assert.ok(icon({ eventType: 'agent_event', body: '{truncated' }))
})
