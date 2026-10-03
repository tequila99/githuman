import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findMentionTrigger,
  mentionLabel,
  serializeEditor
} from '@/utils/mention-editor'
import { nextOptionValue, optionByCategory } from '@/utils/agent-config'
import type { AgentConfigOption } from '@/api/types'

test('a mention opens at an @ that starts the text or follows white space', () => {
  assert.deepEqual(findMentionTrigger('@'), { query: '', start: 0 })
  assert.deepEqual(findMentionTrigger('look at @src/a'), {
    query: 'src/a',
    start: 8
  })
  assert.deepEqual(findMentionTrigger('line one\n@ab'), {
    query: 'ab',
    start: 9
  })
})

test('an e-mail address, a second @ or a blank in the query is not a mention', () => {
  assert.equal(findMentionTrigger('me@example.com'), null)
  assert.equal(findMentionTrigger('@a@b'), null)
  assert.equal(findMentionTrigger('@src a'), null)
  assert.equal(findMentionTrigger('no mention'), null)
  assert.equal(findMentionTrigger(''), null)
})

test('a chip shows the file name, with its folder when two mentions share a name', () => {
  assert.equal(mentionLabel('src/a.ts', ['src/a.ts']), 'a.ts')
  assert.equal(
    mentionLabel('src/a/index.ts', ['src/a/index.ts', 'src/b/index.ts']),
    'a/index.ts'
  )
  assert.equal(
    mentionLabel('README.md', ['README.md', 'docs/README.md']),
    'README.md'
  )
})

test('serializing joins text, line breaks and mentions; each file is listed once', () => {
  const result = serializeEditor([
    { type: 'text', text: 'please fix ' },
    { type: 'mention', path: 'src/a.ts' },
    { type: 'text', text: ' and ' },
    { type: 'br' },
    { type: 'text', text: 'also ' },
    { type: 'mention', path: 'src/a.ts' },
    { type: 'mention', path: 'b.ts' },
    { type: 'text', text: '  ' }
  ])
  assert.equal(result.text, 'please fix @src/a.ts and \nalso @src/a.ts@b.ts')
  assert.deepEqual(result.files, ['src/a.ts', 'b.ts'])
})

test('blocks (new lines made by the browser) each start on their own line', () => {
  const result = serializeEditor([
    { type: 'text', text: 'one' },
    { type: 'block', children: [{ type: 'text', text: 'two' }] },
    { type: 'block', children: [{ type: 'br' }] },
    { type: 'block', children: [{ type: 'text', text: 'three' }] }
  ])
  assert.equal(result.text, 'one\ntwo\n\nthree')
})

test('an empty editor serializes to nothing', () => {
  assert.deepEqual(serializeEditor([]), { text: '', files: [] })
  assert.deepEqual(
    serializeEditor([{ type: 'br' }, { type: 'text', text: ' ' }]),
    {
      text: '',
      files: []
    }
  )
})

const mode: AgentConfigOption = {
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: 'plan',
  options: [
    { value: 'agent', name: 'Agent' },
    { value: 'plan', name: 'Plan' },
    { value: 'ask', name: 'Ask' }
  ]
}

test('Shift+Tab cycles through the mode values and wraps around', () => {
  assert.equal(nextOptionValue(mode), 'ask')
  assert.equal(nextOptionValue({ ...mode, currentValue: 'ask' }), 'agent')
  assert.equal(nextOptionValue({ ...mode, currentValue: 'unknown' }), 'agent')
})

test('there is nothing to cycle with fewer than two values', () => {
  assert.equal(
    nextOptionValue({ ...mode, options: [mode.options![0]!] }),
    undefined
  )
  assert.equal(nextOptionValue({ ...mode, options: [] }), undefined)
})

test('settings are found by their semantic category; booleans never count', () => {
  const fast: AgentConfigOption = {
    id: 'fast',
    name: 'Fast',
    category: 'mode',
    type: 'boolean',
    currentValue: false
  }
  assert.equal(optionByCategory([fast, mode], 'mode'), mode)
  assert.equal(optionByCategory([mode], 'model'), undefined)
})
