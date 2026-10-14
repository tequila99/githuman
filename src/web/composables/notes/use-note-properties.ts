import { computed, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import {
  noteProperties,
  setNoteProperty,
  removeNoteProperty,
  type NotePropertyValue
} from '../../../shared/notes/document.ts'
import { errorMessage } from '@/utils/error-message'

export function useNoteProperties(
  text: MaybeRefOrGetter<string>,
  change: (text: string) => void
) {
  const localError = shallowRef('')
  const parsed = computed(() => {
    try {
      return { properties: noteProperties(toValue(text)), error: '' }
    } catch (err) {
      return { properties: [], error: errorMessage(err) }
    }
  })
  const properties = computed(() => parsed.value.properties)
  const error = computed(() => parsed.value.error || localError.value)
  function update(action: (text: string) => string) {
    try {
      change(action(toValue(text)))
      localError.value = ''
    } catch (err) {
      localError.value = errorMessage(err)
    }
  }
  function set(key: string, value: NotePropertyValue) {
    update(current => setNoteProperty(current, key, value))
  }
  function remove(key: string) {
    update(current => removeNoteProperty(current, key))
  }
  function add(key: string, value: NotePropertyValue) {
    const name = key.trim()
    if (properties.value.some(property => property.key === name)) {
      localError.value = 'This property already exists'
      return false
    }
    set(name, value)
    return !localError.value && !parsed.value.error
  }
  return { properties, error, set, remove, add }
}
