import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  noteProperties,
  setNoteProperty,
  removeNoteProperty,
  splitNote
} from '../../../src/shared/notes/document.ts'

test('reads ordered properties with native scalar, list and mapping values', () => {
  const text =
    '---\ntitle: Hello\nsource: https://example.com\nauthor: ["[[Writer]]"]\npublished: 2026-03-24\nflag: true\ncount: 12\nextra: { x: 1 }\n---\nBody'
  const props = noteProperties(text)
  assert.deepEqual(
    props.map(item => item.key),
    ['title', 'source', 'author', 'published', 'flag', 'count', 'extra']
  )
  assert.deepEqual(
    props.map(item => item.value),
    [
      'Hello',
      'https://example.com',
      ['[[Writer]]'],
      '2026-03-24',
      true,
      12,
      { x: 1 }
    ]
  )
  assert.deepEqual(noteProperties('Body'), [])
})

test('property changes preserve body, BOM, CRLF, comments and unrelated YAML', () => {
  const text =
    '\uFEFF---\r\n# keep\r\ntitle: "Hello" # title\r\ncustom: { x: 1 }\r\nauthor: ["[[Writer]]"]\r\n---\r\n# Body\r\n'
  assert.equal(setNoteProperty(text, 'title', 'Hello'), text)
  const edited = setNoteProperty(text, 'title', 'Updated')
  assert.equal(splitNote(edited).body, '# Body\r\n')
  assert.ok(edited.startsWith('\uFEFF---\r\n'))
  assert.ok(edited.includes('# keep'))
  assert.ok(edited.includes('# title'))
  assert.ok(edited.includes('custom: { x: 1 }'))
  assert.deepEqual(
    noteProperties(edited).find(item => item.key === 'author')?.value,
    ['[[Writer]]']
  )
  assert.equal(removeNoteProperty(text, 'absent'), text)
  const removed = removeNoteProperty(edited, 'author')
  assert.equal(
    noteProperties(removed).some(item => item.key === 'author'),
    false
  )
  assert.equal(splitNote(removed).body, '# Body\r\n')
})

test('adds typed properties and never treats body YAML as frontmatter', () => {
  let text = 'Link\n\n---\ntitle: example\n---\nBody'
  assert.deepEqual(noteProperties(text), [])
  const body = text
  text = setNoteProperty(text, 'enabled', false)
  text = setNoteProperty(text, 'items', ['a', 'b'])
  text = setNoteProperty(text, 'tags', [' cat ', 'cat'])
  assert.equal(splitNote(text).body, body)
  assert.deepEqual(noteProperties(text), [
    { key: 'enabled', value: false },
    { key: 'items', value: ['a', 'b'] },
    { key: 'tags', value: ['cat'] }
  ])
  for (const malformed of [
    '---\n- item\n---\n',
    '---\nbroken: [\n---\n',
    '---\nnot closed'
  ]) {
    assert.throws(() => noteProperties(malformed))
    assert.throws(() => setNoteProperty(malformed, 'title', 'oops'))
    assert.throws(() => removeNoteProperty(malformed, 'title'))
  }
  assert.throws(() => setNoteProperty('', '', 'bad'))
  assert.throws(() => setNoteProperty('', 'tags', 'bad'))
})
