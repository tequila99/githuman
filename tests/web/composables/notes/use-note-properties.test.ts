import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { useNoteProperties } from '@/composables/notes/use-note-properties'

test('property edits use latest source and reject duplicate additions', () => {
  const text = shallowRef('---\ntitle: First\n---\nBody')
  const properties = useNoteProperties(
    () => text.value,
    value => {
      text.value = value
    }
  )
  properties.set('title', 'Second')
  assert.equal(properties.properties.value[0]?.value, 'Second')
  assert.equal(properties.add(' title ', 'oops'), false)
  assert.ok(properties.error.value)
  assert.equal(properties.add('flag', true), true)
  assert.equal(properties.error.value, '')
  properties.remove('title')
  assert.deepEqual(properties.properties.value, [{ key: 'flag', value: true }])
})

test('malformed headers remain unchanged and report errors', () => {
  const text = '---\ntitle: [\n---\nBody'
  const changes: string[] = []
  const properties = useNoteProperties(text, value => changes.push(value))
  assert.ok(properties.error.value)
  properties.set('title', 'replaced')
  assert.equal(changes.length, 0)
})
