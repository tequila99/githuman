import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uniqueChatName } from '../../../src/shared/agents/chat-names.ts'

test('a free name is kept as it is (trimmed)', () => {
  assert.equal(uniqueChatName('Claude', []), 'Claude')
  assert.equal(uniqueChatName('  Claude  ', ['Cursor']), 'Claude')
})

test('a taken name gets the first free number: (1), (2), …', () => {
  assert.equal(uniqueChatName('Claude', ['Claude']), 'Claude (1)')
  assert.equal(uniqueChatName('Claude', ['Claude', 'Claude (1)']), 'Claude (2)')
  assert.equal(
    uniqueChatName('Claude', ['Claude', 'Claude (2)']),
    'Claude (1)',
    'a gap is filled'
  )
})

test('case and blanks around a name do not make it a different one', () => {
  assert.equal(uniqueChatName('claude', [' Claude ']), 'claude (1)')
})
