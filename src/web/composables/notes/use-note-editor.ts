import { computed, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import {
  noteMetadata,
  setNoteTags,
  splitNote
} from '../../../shared/notes/document.ts'
import { errorMessage } from '@/utils/error-message'

export type NoteEditorMode = 'visual' | 'source'

export function useNoteEditor(
  text: MaybeRefOrGetter<string>,
  change: (text: string) => void
) {
  const metadata = computed(() => noteMetadata(toValue(text)))
  const mode = shallowRef<NoteEditorMode>(
    metadata.value.error ? 'source' : 'visual'
  )
  const localError = shallowRef('')
  const visualUnsupported = shallowRef(false)
  const editorError = computed(() => metadata.value.error || localError.value)
  const parts = computed(() => {
    const current = toValue(text)
    try {
      return splitNote(current)
    } catch {
      return { head: '', body: current }
    }
  })
  const tags = computed({
    get: () => metadata.value.tags,
    set: (value: string[]) => {
      try {
        change(setNoteTags(toValue(text), value))
        localError.value = ''
      } catch (error) {
        localError.value = errorMessage(error)
      }
    }
  })
  function changeBody(body: string) {
    change(parts.value.head + body)
  }
  function unsupported() {
    mode.value = 'source'
    visualUnsupported.value = true
  }
  function visualReady() {
    visualUnsupported.value = false
  }
  return {
    metadata,
    mode,
    parts,
    tags,
    editorError,
    visualUnsupported,
    changeBody,
    unsupported,
    visualReady
  }
}
