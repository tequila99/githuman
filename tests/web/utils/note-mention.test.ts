import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@milkdown/kit/prose/model'
import { findNoteMentionTrigger } from '@/utils/note-mention'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {}
  },
  marks: { link: { attrs: { href: {} }, inclusive: false } }
})

test('note suggestions open immediately after a link and after a space', () => {
  for (const suffix of ['@', ' @', '@cat']) {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text('link', [schema.marks.link.create({ href: 'note.md' })]),
      schema.text(suffix)
    ])
    assert.deepEqual(
      findNoteMentionTrigger(paragraph, paragraph.content.size),
      {
        query: suffix.includes('cat') ? 'cat' : '',
        start: suffix.startsWith(' ') ? 5 : 4
      }
    )
  }
})

test('ordinary text still requires a space before a note mention', () => {
  const paragraph = schema.nodes.paragraph.create(
    null,
    schema.text('mail@example.com')
  )
  assert.equal(findNoteMentionTrigger(paragraph, paragraph.content.size), null)
})

test('typing after a link does not inherit the link mark', () => {
  const paragraph = schema.nodes.paragraph.create(null, [
    schema.text('link', [schema.marks.link.create({ href: 'note.md' })])
  ])
  const doc = schema.nodes.doc.create(null, paragraph)
  assert.deepEqual(doc.resolve(5).marks(), [])
  assert.equal(doc.resolve(3).marks()[0]?.type.name, 'link')
})
