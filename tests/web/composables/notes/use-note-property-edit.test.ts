import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef } from 'vue'
import type {
  NoteProperty,
  NotePropertyValue
} from '../../../../src/shared/notes/document.ts'
import { useNotePropertyEdit } from '@/composables/notes/use-note-property-edit'

function scoped(t: { after: (fn: () => void) => void }) {
  const scope = effectScope()
  t.after(() => scope.stop())
  return scope
}

test('plain properties preserve multiline text and commit only once', t => {
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit({ key: 'description', value: 'Old' }, value =>
      changes.push(value)
    )
  )!
  edit.start()
  assert.equal(edit.draft.value, 'Old')
  edit.draft.value = 'First\nSecond'
  edit.commit()
  edit.commit()
  assert.deepEqual(changes, ['First\nSecond'])
  assert.equal(edit.editing.value, false)
})

test('cancel prevents a subsequent blur commit', t => {
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit({ key: 'description', value: 'Old' }, value =>
      changes.push(value)
    )
  )!
  edit.start()
  edit.draft.value = 'Discarded'
  edit.cancel()
  edit.commit()
  assert.deepEqual(changes, [])
  edit.start()
  assert.equal(edit.draft.value, 'Old')
})

test('numbers reject nonfinite drafts, recover after correction, and accept empty as null', t => {
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit({ key: 'count', value: 2 }, value =>
      changes.push(value)
    )
  )!
  for (const value of ['wrong', 'Infinity', '1e999']) {
    edit.start()
    edit.draft.value = value
    edit.commit()
    assert.equal(edit.invalid.value, true)
    assert.equal(edit.editing.value, true)
  }
  edit.draft.value = '3.5'
  edit.commit()
  assert.equal(edit.invalid.value, false)
  edit.start()
  edit.draft.value = '  '
  edit.commit()
  assert.deepEqual(changes, [3.5, null])
})

test('ref inputs append to the latest list without overwriting the draft', t => {
  const property = shallowRef<NoteProperty>({ key: 'links', value: ['A'] })
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit(property, value => changes.push(value))
  )!
  edit.start()
  edit.draft.value = '  C  '
  property.value = { key: 'links', value: ['A', 'B'] }
  assert.equal(edit.editing.value, true)
  assert.equal(edit.draft.value, '  C  ')
  edit.commit()
  assert.deepEqual(changes, [['A', 'B', 'C']])
})

test('getter inputs remove one duplicate by index and ignore empty additions', t => {
  const property = shallowRef<NoteProperty>({
    key: 'links',
    value: ['A', 'A', 'B']
  })
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit(
      () => property.value,
      value => changes.push(value)
    )
  )!
  edit.removeItem(1)
  edit.start()
  edit.draft.value = '  '
  edit.commit()
  assert.deepEqual(changes, [
    ['A', 'B'],
    ['A', 'A', 'B']
  ])
})

test('changing key or type cancels synchronously before a stale commit', t => {
  const property = shallowRef<NoteProperty>({ key: 'old', value: 'Text' })
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit(property, value => changes.push(value))
  )!
  edit.start()
  edit.draft.value = 'Stale'
  property.value = { key: 'new', value: 'Next' }
  edit.commit()
  assert.equal(edit.editing.value, false)
  edit.start()
  edit.draft.value = 'Another stale'
  property.value = { key: 'new', value: 5 }
  edit.commit()
  assert.equal(edit.editing.value, false)
  assert.deepEqual(changes, [])
})

test('date drafts preserve ISO values and boolean or complex values do not start editing', t => {
  const property = shallowRef<NoteProperty>({
    key: 'date',
    value: '2026-10-14'
  })
  const changes: NotePropertyValue[] = []
  const edit = scoped(t).run(() =>
    useNotePropertyEdit(property, value => changes.push(value))
  )!
  edit.start()
  assert.equal(edit.type.value, 'date')
  assert.equal(edit.draft.value, '2026-10-14')
  edit.draft.value = '2026-10-15'
  edit.commit()
  assert.deepEqual(changes, ['2026-10-15'])
  for (const value of [false, { nested: 'read only' }]) {
    property.value = { key: 'other', value }
    edit.start()
    assert.equal(edit.editing.value, false)
  }
})
