import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { useNoteProperties } from '@/composables/notes/use-note-properties'
import { useNotePropertyCreate } from '@/composables/notes/use-note-property-create'
import type { NotePropertyCreateType } from '@/utils/notes/properties'
import type { NotePropertyValue } from '../../../../src/shared/notes/document.ts'

test('cancel preserves the name and type for reopening', () => {
  const form = useNotePropertyCreate(() => true)
  form.start()
  form.name.value = 'count'
  form.type.value = 'number'
  form.cancel()
  assert.equal(form.adding.value, false)
  form.start()
  assert.equal(form.name.value, 'count')
  assert.equal(form.type.value, 'number')
})

test('successful creation uses typed defaults and resets the form', () => {
  const changes: { key: string; value: NotePropertyValue }[] = []
  const form = useNotePropertyCreate((key, value) => {
    changes.push({ key, value })
    return true
  })
  for (const [type, value] of [
    ['text', ''],
    ['number', 0],
    ['boolean', false],
    ['list', []]
  ] as [NotePropertyCreateType, NotePropertyValue][]) {
    form.start()
    form.name.value = type
    form.type.value = type
    assert.equal(form.submit(), true)
    assert.equal(form.adding.value, false)
    assert.equal(form.name.value, '')
    assert.equal(form.type.value, 'text')
    assert.deepEqual(changes.at(-1), { key: type, value })
  }
  form.start()
  form.name.value = ' tags '
  form.type.value = 'boolean'
  form.submit()
  assert.deepEqual(changes.at(-1), { key: ' tags ', value: [] })
})

test('duplicate and invalid YAML failures retain input and allow retry on the latest text', () => {
  const text = shallowRef('---\ncount: 7\n---\nBody')
  const properties = useNoteProperties(text, value => {
    text.value = value
  })
  const form = useNotePropertyCreate(properties.add)
  form.start()
  form.name.value = ' count '
  form.type.value = 'number'
  assert.equal(form.submit(), false)
  assert.equal(form.adding.value, true)
  assert.equal(form.name.value, ' count ')
  assert.equal(form.type.value, 'number')
  assert.ok(properties.error.value)
  assert.equal(text.value, '---\ncount: 7\n---\nBody')
  text.value = '---\nbroken: [\n---\nBody'
  form.name.value = 'next'
  assert.equal(form.submit(), false)
  assert.equal(form.name.value, 'next')
  text.value = '---\nother: kept\n---\nNew body'
  assert.equal(form.submit(), true)
  assert.deepEqual(properties.properties.value, [
    { key: 'other', value: 'kept' },
    { key: 'next', value: 0 }
  ])
  assert.ok(text.value.endsWith('New body'))
})

test('blank names do not submit and date defaults retain the UTC day', t => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-10-14T23:30:00Z')
  })
  const changes: NotePropertyValue[] = []
  const form = useNotePropertyCreate((_key, value) => {
    changes.push(value)
    return true
  })
  form.start()
  form.name.value = '   '
  assert.equal(form.submit(), false)
  assert.equal(form.adding.value, true)
  assert.deepEqual(changes, [])
  form.name.value = 'date'
  form.type.value = 'date'
  assert.equal(form.submit(), true)
  assert.deepEqual(changes, ['2026-10-14'])
})
