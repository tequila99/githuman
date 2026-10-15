import { nextTick, toValue, type MaybeRefOrGetter } from 'vue'
import {
  externalAssetOffset,
  type ExternalAssetEdit
} from '../../../shared/notes/external-assets.ts'
import type { NoteEditorMode } from './use-note-editor'

export function useNoteEditorPosition(
  body: MaybeRefOrGetter<HTMLElement | null>,
  mode: MaybeRefOrGetter<NoteEditorMode>,
  change: (text: string) => void,
  remountVisual: () => void
) {
  let pendingVisualScroll: number | null = null
  function apply(text: string, edits: ExternalAssetEdit[]) {
    const element = toValue(body)
    const input = element?.querySelector<HTMLTextAreaElement>(
      'textarea.note-source'
    )
    const start = input?.selectionStart ?? 0
    const end = input?.selectionEnd ?? 0
    const scroll = input?.scrollTop ?? 0
    const bodyScroll = element?.scrollTop ?? 0
    change(text)
    if (toValue(mode) === 'visual') {
      pendingVisualScroll = bodyScroll
      remountVisual()
    }
    void nextTick(() => {
      input?.setSelectionRange(
        externalAssetOffset(start, edits),
        externalAssetOffset(end, edits)
      )
      if (input) input.scrollTop = scroll
      if (element) element.scrollTop = bodyScroll
    })
  }
  function ready() {
    if (pendingVisualScroll === null) return
    const scroll = pendingVisualScroll
    pendingVisualScroll = null
    void nextTick(() => {
      const element = toValue(body)
      if (element) element.scrollTop = scroll
    })
  }
  return { apply, ready }
}
