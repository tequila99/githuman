import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateAgentStatus } from '@/utils/agent-chat-status'

test('any pending permission takes precedence over working chats', () => {
  assert.equal(
    aggregateAgentStatus([{ permissions: [], status: 'busy' }]),
    'working'
  )
  assert.equal(
    aggregateAgentStatus([
      { permissions: [], status: 'busy' },
      {
        permissions: [
          {
            requestId: 'p',
            toolCallId: 't',
            title: 'Confirm',
            options: [],
            diffs: []
          }
        ],
        status: 'ready'
      }
    ]),
    'attention'
  )
  assert.equal(
    aggregateAgentStatus([
      { permissions: [], status: 'ready' },
      { permissions: [], status: 'closed' }
    ]),
    null
  )
  assert.equal(aggregateAgentStatus([]), null)
})
