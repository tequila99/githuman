import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { useNoteEditor } from '@/composables/notes/use-note-editor'
import { noteMetadata } from '../../../../src/shared/notes/document.ts'

test('body changes preserve the original YAML header and read the latest reactive text', () => {
  const head = '\uFEFF---\r\n# keep this comment\r\ntags: [cat]\r\n---\r\n'
  const text = shallowRef(head + 'Old body')
  const changed: string[] = []
  const editor = useNoteEditor(text, value => changed.push(value))
  editor.changeBody('New body')
  assert.equal(changed[0], head + 'New body')
  text.value = '---\ntags: [dog]\n---\nOther body'
  assert.deepEqual(editor.tags.value, ['dog'])
  editor.changeBody('Updated')
  assert.equal(changed[1], '---\ntags: [dog]\n---\nUpdated')
})

test('plain values and getters work, and tag edits use the current source', () => {
  const plain = useNoteEditor('Body', () => {})
  assert.equal(plain.mode.value, 'visual')
  assert.equal(plain.parts.value.body, 'Body')
  const text = shallowRef('First')
  const editor = useNoteEditor(
    () => text.value,
    value => {
      text.value = value
    }
  )
  text.value = 'Second'
  editor.tags.value = ['cat']
  assert.deepEqual(noteMetadata(text.value).tags, ['cat'])
  assert.equal(editor.parts.value.body, 'Second')
})

test('malformed frontmatter remains intact and forces initial source mode', () => {
  const text = shallowRef('---\ntags: [broken')
  const changed: string[] = []
  const editor = useNoteEditor(
    () => text.value,
    value => changed.push(value)
  )
  assert.equal(editor.mode.value, 'source')
  assert.ok(editor.editorError.value)
  assert.equal(editor.parts.value.body, text.value)
  editor.tags.value = ['cat']
  assert.equal(changed.length, 0)
  text.value = 'Repaired body'
  editor.tags.value = ['cat']
  assert.equal(editor.editorError.value, '')
  assert.equal(changed.length, 1)
})

test('unsupported visual content falls back to source until the visual editor is ready', () => {
  const editor = useNoteEditor('Body', () => {})
  editor.unsupported()
  assert.equal(editor.mode.value, 'source')
  assert.equal(editor.visualUnsupported.value, true)
  editor.visualReady()
  assert.equal(editor.visualUnsupported.value, false)
})
