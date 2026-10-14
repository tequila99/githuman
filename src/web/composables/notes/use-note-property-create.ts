import { readonly, shallowRef } from 'vue'
import type { NotePropertyValue } from '../../../shared/notes/document.ts'
import {
  notePropertyInitialValue,
  type NotePropertyCreateType
} from '@/utils/notes/properties'

export function useNotePropertyCreate(
  add: (key: string, value: NotePropertyValue) => boolean
) {
  const adding = shallowRef(false)
  const name = shallowRef('')
  const type = shallowRef<NotePropertyCreateType>('text')
  function start() {
    adding.value = true
  }
  function cancel() {
    adding.value = false
  }
  function submit() {
    if (!name.value.trim()) return false
    if (!add(name.value, notePropertyInitialValue(name.value, type.value))) {
      return false
    }
    adding.value = false
    name.value = ''
    type.value = 'text'
    return true
  }
  return { adding: readonly(adding), name, type, start, cancel, submit }
}
