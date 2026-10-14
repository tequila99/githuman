import {
  computed,
  readonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import type {
  NoteProperty,
  NotePropertyValue
} from '../../../shared/notes/document.ts'
import { notePropertyType } from '@/utils/notes/properties'

export function useNotePropertyEdit(
  property: MaybeRefOrGetter<NoteProperty>,
  change: (value: NotePropertyValue) => void
) {
  const type = computed(() => notePropertyType(toValue(property)))
  const items = computed(() => {
    const value = toValue(property).value
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  })
  const editing = shallowRef(false)
  const draft = shallowRef('')
  const invalid = shallowRef(false)
  function cancel() {
    editing.value = false
    invalid.value = false
  }
  // Cancel before a blur can apply the old draft to a changed property.
  watch([() => toValue(property).key, type], cancel, { flush: 'sync' })
  function start() {
    if (!['text', 'number', 'date', 'list'].includes(type.value)) return
    const value = toValue(property).value
    draft.value =
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : ''
    invalid.value = false
    editing.value = true
  }
  function commit() {
    if (!editing.value) return
    let value: NotePropertyValue = draft.value
    if (type.value === 'number') {
      value = draft.value.trim() === '' ? null : Number(draft.value)
      if (value !== null && !Number.isFinite(value)) {
        invalid.value = true
        return
      }
    } else if (type.value === 'list') {
      value = draft.value.trim()
        ? [...items.value, draft.value.trim()]
        : items.value
    }
    editing.value = false
    invalid.value = false
    change(value)
  }
  function removeItem(index: number) {
    if (type.value !== 'list') return
    change(items.value.filter((_, position) => position !== index))
  }
  return {
    type,
    items,
    editing: readonly(editing),
    invalid: readonly(invalid),
    draft,
    start,
    commit,
    cancel,
    removeItem
  }
}
