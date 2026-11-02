import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  RequestPermissionRequest,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import {
  AgentSession,
  type AgentPermissionPolicy
} from '../../../../src/server/services/agent/agent-session.ts'

const request: RequestPermissionRequest = {
  sessionId: 'probe',
  toolCall: { toolCallId: 'call', title: 'Untrusted title' },
  options: [
    { optionId: 'persistent', name: 'Always', kind: 'allow_always' },
    { optionId: 'once', name: 'Once', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' }
  ]
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'permission probe did not finish')
    await delay(10)
  }
}

function session(policy?: AgentPermissionPolicy) {
  return new AgentSession({
    preset: {
      id: 'probe',
      title: 'Probe',
      command: process.execPath,
      args: [
        join(import.meta.dirname, '../../fixtures/fake-acp-permission-agent.ts')
      ],
      autoApprovesEdits: false
    },
    name: 'Probe',
    cwd: process.cwd(),
    permissionPolicy: policy
  })
}

async function prompt(
  agent: AgentSession,
  requests: RequestPermissionRequest[],
  updates: SessionUpdate[] = []
) {
  const text = JSON.stringify({ requests, updates })
  agent.prompt([{ type: 'text', text }], { text })
  await until(() => agent.status === 'ready')
  return agent.replay(0).envelopes.map(envelope => envelope.event)
}

test('fixed policies never queue manual permissions and only grant allow_once', async t => {
  const agent = session(() => ({ allow: true, reason: 'Assigned operation' }))
  t.after(() => agent.close())
  await agent.start()
  assert.throws(() => agent.setAutoApprove(true), /fixed permission policy/)
  let events = await prompt(agent, [request])
  assert.equal(agent.state().autoApprove, false)
  assert.equal(agent.state().permissions.length, 0)
  assert.ok(!events.some(event => event.type === 'permission'))
  assert.ok(
    events.some(
      event =>
        event.type === 'auto-approved' && event.title === 'Assigned operation'
    )
  )
  assert.ok(
    events.some(
      event =>
        event.type === 'message' && event.text.includes('"optionId":"once"')
    )
  )
  events = await prompt(agent, [
    {
      ...request,
      options: request.options.filter(option => option.kind !== 'allow_once')
    }
  ])
  assert.ok(
    events.some(
      event =>
        event.type === 'tool' &&
        event.output?.includes('requires an allow_once')
    )
  )
  assert.ok(
    events.some(
      event =>
        event.type === 'message' && event.text.includes('"optionId":"no"')
    )
  )
})

test('denials and policy failures return immediately, with an audit reason', async t => {
  for (const policy of [
    () => ({ allow: false, reason: 'Outside assigned manifest' }),
    () => {
      throw new Error('private details')
    }
  ]) {
    const agent = session(policy)
    t.after(() => agent.close())
    await agent.start()
    const events = await prompt(agent, [
      {
        ...request,
        options: request.options.filter(option => option.kind !== 'reject_once')
      }
    ])
    assert.ok(
      events.some(
        event => event.type === 'message' && event.text.includes('cancelled')
      )
    )
    assert.ok(
      events.some(event => event.type === 'tool' && event.status === 'failed')
    )
    assert.ok(
      !events.some(
        event => event.type === 'permission' || event.type === 'auto-approved'
      )
    )
    assert.ok(!JSON.stringify(events).includes('private details'))
  }
})

test('tool context merges partial updates and cannot survive a turn or a decision', async t => {
  const contexts: unknown[] = []
  const agent = session((_request, previous) => {
    contexts.push(previous?.rawInput)
    return { allow: false, reason: 'Probe context' }
  })
  t.after(() => agent.close())
  await agent.start()
  await prompt(
    agent,
    [request, request],
    [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call',
        title: 'MCP',
        kind: 'execute',
        rawInput: { server: 'githuman_artifacts' }
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call',
        status: 'pending'
      }
    ]
  )
  await prompt(agent, [request])
  assert.deepEqual(contexts, [
    { server: 'githuman_artifacts' },
    undefined,
    undefined
  ])
  const unconsumed: SessionUpdate = {
    sessionUpdate: 'tool_call',
    toolCallId: 'call',
    title: 'MCP',
    rawInput: { id: 'must not survive this turn' }
  }
  await prompt(agent, [], [unconsumed])
  await prompt(agent, [request])
  assert.equal(contexts.at(-1), undefined)
  const updates: SessionUpdate[] = Array.from({ length: 65 }, (_, index) => ({
    sessionUpdate: 'tool_call',
    toolCallId: `bounded-${index}`,
    title: 'MCP',
    rawInput: { index }
  }))
  await prompt(
    agent,
    [
      { ...request, toolCall: { toolCallId: 'bounded-0' } },
      { ...request, toolCall: { toolCallId: 'bounded-64' } }
    ],
    updates
  )
  assert.deepEqual(contexts.slice(-2), [undefined, { index: 64 }])
})

test('ordinary chats continue to wait for an explicit permission answer', async t => {
  const agent = session()
  t.after(() => agent.close())
  await agent.start()
  const text = JSON.stringify({ requests: [request] })
  agent.prompt([{ type: 'text', text }], { text })
  await until(() => agent.state().permissions.length === 1)
  const pending = agent.state().permissions[0]
  assert.equal(agent.status, 'busy')
  assert.equal(agent.answerPermission(pending.requestId, 'no'), true)
  await until(() => agent.status === 'ready')
})
