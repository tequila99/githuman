import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  noteMetadata,
  setNoteTags,
  splitNote
} from '../../../src/shared/notes/document.ts'
import { noteLink, resolveNoteLink } from '../../../src/shared/notes/links.ts'

test('preserves BOM, CRLF, unknown fields and comments when editing tags', () => {
  const text =
    '\uFEFF---\r\n# keep me\r\ntitle: "Hello" # title\r\ncustom: {x: 1}\r\ntags: [old]\r\n---\r\n# Body\r\n'
  assert.equal(splitNote(text).head + splitNote(text).body, text)
  assert.equal(setNoteTags(text, ['old']), text)
  const changed = setNoteTags(text, [' новый ', 'новый', 'Ideas'])
  assert.deepEqual(noteMetadata(changed), {
    tags: ['новый', 'Ideas'],
    error: null
  })
  assert.ok(changed.startsWith('\uFEFF---\r\n'))
  assert.ok(changed.includes('# keep me'))
  assert.ok(changed.includes('# title'))
  assert.ok(changed.includes('custom: { x: 1 }'))
  assert.equal(splitNote(changed).body, '# Body\r\n')
})
test('rejects malformed YAML and non-string tags without replacing content', () => {
  for (const text of [
    '---\ntags: nope\n---\n',
    '---\ntags: [1]\n---\n',
    '---\ntags: [\n---\n',
    '---\nmissing end',
    '---\n- sequence\n---\n'
  ]) {
    assert.ok(noteMetadata(text).error)
    assert.throws(() => setNoteTags(text, ['tag']))
  }
  assert.deepEqual(noteMetadata(''), { tags: [], error: null })
  assert.equal(setNoteTags('# Hello', []), '# Hello')
  assert.equal(splitNote('---\n---\nbody').body, 'body')
})
test('relative links roundtrip special characters and nested folders', () => {
  const target = 'Мои заметки/Plan #1% (new).md'
  const href = noteLink('drafts/next.md', target)
  assert.deepEqual(resolveNoteLink('drafts/next.md', href + '#hello'), {
    path: target,
    anchor: 'hello'
  })
  assert.deepEqual(resolveNoteLink('a.md', '#intro'), {
    path: 'a.md',
    anchor: 'intro'
  })
  assert.equal(resolveNoteLink('a.md', 'https://example.com'), null)
  for (const bad of [
    '../secret.md',
    '%2Fetc/passwd.md',
    '%5csecret.md',
    '%00.md'
  ]) {
    assert.throws(() => resolveNoteLink('a.md', bad))
  }
})
