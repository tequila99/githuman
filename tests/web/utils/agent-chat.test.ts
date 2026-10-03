import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEnvelope,
  createChatState,
  hasReviewContext,
  parseEnvelope
} from '@/utils/agent-chat'
import type { AgentChatEvent } from '@/api/types'

test('parseEnvelope accepts a well-formed payload and rejects everything else', () => {
  const ok = { id: 1, event: { type: 'stop', stopReason: 'end_turn' } }
  assert.deepEqual(parseEnvelope(JSON.stringify(ok)), ok)
  for (const bad of [
    'nope',
    '1',
    'null',
    '{}',
    '{"id":"1","event":{"type":"x"}}',
    '{"id":1,"event":{}}'
  ]) {
    assert.equal(parseEnvelope(bad), null, bad)
  }
})

function feed(events: AgentChatEvent[], startId = 1) {
  const state = createChatState()
  events.forEach((event, i) => applyEnvelope(state, { id: startId + i, event }))
  return state
}

test('message chunks of the same role are concatenated into one item', () => {
  const state = feed([
    { type: 'message', role: 'agent', text: 'Hel' },
    { type: 'message', role: 'agent', text: 'lo' }
  ])
  assert.equal(state.items.length, 1)
  assert.deepEqual(state.items[0], { kind: 'agent', id: 'ev:1', text: 'Hello' })
})

test('thoughts, tools and the next user turn split agent text into separate items', () => {
  const state = feed([
    { type: 'message', role: 'thought', text: 'hm' },
    { type: 'message', role: 'agent', text: 'a' },
    { type: 'tool', toolCallId: 't', title: 'Write', status: 'pending' },
    { type: 'message', role: 'agent', text: 'b' }
  ])
  assert.deepEqual(
    state.items.map(i => i.kind),
    ['thought', 'agent', 'tool', 'agent']
  )
})

test('tool updates merge by toolCallId and keep fields that were not resent', () => {
  const state = feed([
    {
      type: 'tool',
      toolCallId: 't1',
      title: 'Write a.txt',
      kind: 'edit',
      status: 'pending',
      locations: ['/r/a.txt']
    },
    {
      type: 'tool',
      toolCallId: 't1',
      diffs: [{ path: '/r/a.txt', oldText: null, newText: 'hi' }]
    },
    { type: 'tool', toolCallId: 't1', status: 'completed' }
  ])
  assert.equal(state.items.length, 1)
  assert.deepEqual(state.items[0], {
    kind: 'tool',
    id: 'tool:t1',
    title: 'Write a.txt',
    toolKind: 'edit',
    status: 'completed',
    locations: ['/r/a.txt'],
    diffs: [{ path: '/r/a.txt', oldText: null, newText: 'hi' }],
    output: undefined
  })
})

test('permission requests are pending until resolved', () => {
  const state = feed([
    {
      type: 'permission',
      requestId: 'r1',
      toolCallId: 't1',
      title: 'Write',
      options: [{ optionId: 'allow', name: 'Yes', kind: 'allow_once' }],
      diffs: []
    }
  ])
  assert.equal(state.permissions.length, 1)
  applyEnvelope(state, {
    id: 2,
    event: { type: 'permission-resolved', requestId: 'r1' }
  })
  assert.equal(state.permissions.length, 0)
})

test('status, usage, stop and error events update state', () => {
  const state = feed([
    { type: 'status', status: 'busy' },
    { type: 'usage', used: 10, size: 100, cost: 0.5 },
    { type: 'stop', stopReason: 'end_turn' },
    { type: 'error', message: 'boom' },
    { type: 'status', status: 'ready' }
  ])
  assert.equal(state.status, 'ready')
  assert.deepEqual(state.usage, { used: 10, size: 100, cost: 0.5 })
  assert.equal(state.lastStopReason, 'end_turn')
  assert.deepEqual(state.items, [{ kind: 'error', id: 'ev:4', text: 'boom' }])
})

test('replayed or out-of-order events (id <= lastEventId) are ignored', () => {
  const state = feed([{ type: 'message', role: 'agent', text: 'a' }], 5)
  applyEnvelope(state, {
    id: 5,
    event: { type: 'message', role: 'agent', text: 'DUP' }
  })
  applyEnvelope(state, {
    id: 3,
    event: { type: 'message', role: 'agent', text: 'OLD' }
  })
  assert.equal(state.items.length, 1)
  assert.equal(state.items[0]?.kind === 'agent' && state.items[0].text, 'a')
  assert.equal(state.lastEventId, 5)
})

test('hasReviewContext sees only user items that carried a review', () => {
  assert.equal(
    hasReviewContext(
      feed([
        { type: 'user', text: 'x', context: [{ kind: 'file', path: 'a' }] }
      ]).items
    ),
    false
  )
  assert.equal(
    hasReviewContext(
      feed([
        {
          type: 'user',
          text: 'x',
          context: [{ kind: 'review', reviewId: 'r' }]
        }
      ]).items
    ),
    true
  )
})

test('a config event replaces the whole option set', () => {
  const state = feed([
    {
      type: 'config',
      options: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'a',
          options: [{ value: 'a', name: 'A' }]
        }
      ]
    },
    {
      type: 'config',
      options: [
        { id: 'fast', name: 'Fast', type: 'boolean', currentValue: true }
      ]
    }
  ])
  assert.deepEqual(
    state.config.map(o => o.id),
    ['fast']
  )
})
