import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hasNoteFrontmatter,
  importNoteDocument
} from '@/utils/notes/document-paste'
import { noteIdentity } from '../../../../src/shared/notes/identity.ts'
import {
  noteProperties,
  splitNote
} from '../../../../src/shared/notes/document.ts'

// A pasted clipping must retain this note's catalog identity.
const CURRENT_ID = 'c7e6104c-3fae-4b06-aa88-fbe86f20abee'
const current = `---\ngithuman_id: ${CURRENT_ID}\n---\n`
const body =
  '![](https://miro.medium.com/example.png)\n\n**Author**: Vaishnavi Gilitwala\n\n## What are Server-Sent Events (SSE)?\n\n```c\nres.write(`data: ${JSON.stringify(payload)}\\n\\n`);\n```\n'
const source =
  '---\ntitle: "Real-Time Data Streaming with Server-Sent Events (SSE) in Node.js"\nsource: "https://medium.com/@gilitwalavaishnavi/article"\nauthor:\n  - "[[Gilitwala Vaishnavi]]"\npublished: 2026-10-09\ncreated: 2026-10-15\ndescription: "More"\ntags:\n  - "clippings"\n---\n' +
  body

test('a full clipping imports frontmatter as properties and retains exact body Markdown', () => {
  const imported = importNoteDocument(current, source)
  assert.equal(noteIdentity(imported).id, CURRENT_ID)
  assert.equal(splitNote(imported).body, body)
  const properties = Object.fromEntries(
    noteProperties(imported).map(property => [property.key, property.value])
  )
  assert.equal(
    properties.title,
    'Real-Time Data Streaming with Server-Sent Events (SSE) in Node.js'
  )
  assert.deepEqual(properties.author, ['[[Gilitwala Vaishnavi]]'])
  assert.deepEqual(properties.tags, ['clippings'])
  assert.equal(properties.published, '2026-10-09')
  assert.equal(properties.description, 'More')
  assert.equal((imported.match(/^---$/gm) ?? []).length, 2)
})

test('the catalog UUID overrides a pasted UUID without changing BOM, CRLF, comments or body', () => {
  const pasted =
    '\uFEFF---\r\n# Keep comment\r\ngithuman_id: 11111111-1111-4111-8111-111111111111\r\ntitle: "Import"\r\n---\r\n## Body\r\n\r\n[Link](folder/a.md)\r\n'
  const imported = importNoteDocument(
    '---\ntitle: Old\n---\n',
    pasted,
    CURRENT_ID
  )
  assert.equal(noteIdentity(imported).id, CURRENT_ID)
  assert.ok(imported.startsWith('\uFEFF---\r\n# Keep comment'))
  assert.equal(splitNote(imported).body, splitNote(pasted).body)
})

test('invalid YAML, tags and unterminated frontmatter are rejected before changing the note', () => {
  for (const invalid of [
    '---\ntitle: [broken\n---\nBody',
    '---\ntitle: Unclosed',
    '---\ntags: clippings\n---\nBody',
    '---\n- not a mapping\n---\nBody'
  ]) {
    assert.throws(() => importNoteDocument(current, invalid))
  }
  assert.equal(hasNoteFrontmatter('# Heading'), false)
  assert.equal(hasNoteFrontmatter('Text\n---\nBody'), false)
  assert.equal(hasNoteFrontmatter('---\r\ntitle: Test\r\n---\r\n'), true)
})
