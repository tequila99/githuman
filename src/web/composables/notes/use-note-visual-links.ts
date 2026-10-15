import { noteTitle } from '../../../shared/notes/note-path.ts'
import { shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Selection } from '@milkdown/kit/prose/state'
import { noteLink } from '../../../shared/notes/links.ts'
import { findNoteMentionTrigger } from '@/utils/note-mention'
import { useNoteLinkSuggestions } from './use-note-link-suggestions'

export function useNoteVisualLinks(
  getView: () => EditorView | undefined,
  pathInput: MaybeRefOrGetter<string>,
  paths: MaybeRefOrGetter<readonly string[]>
) {
  const popup = shallowRef<{
    from: number
    to: number
    query: string
    left: number
    top: number
  } | null>(null)
  const { matches, active, move } = useNoteLinkSuggestions(
    paths,
    () => popup.value?.query ?? null
  )
  let savedSelection: Selection | undefined
  let dismissed: number | undefined
  function updatePopup(view: EditorView) {
    const { selection } = view.state
    const cursor = selection.$from
    const trigger =
      selection.empty &&
      cursor.parent.isTextblock &&
      !cursor.parent.type.spec.code
        ? findNoteMentionTrigger(cursor.parent, cursor.parentOffset)
        : null
    if (
      !trigger ||
      cursor
        .marks()
        .some(
          mark => mark.type.name === 'link' || mark.type.name === 'inlineCode'
        )
    ) {
      popup.value = null
      dismissed = undefined
      return
    }
    const from = cursor.start() + trigger.start
    if (dismissed === from) return
    const coords = view.coordsAtPos(selection.from)
    popup.value = {
      from,
      to: selection.from,
      query: trigger.query,
      left: Math.max(8, Math.min(coords.left, window.innerWidth - 340)),
      top: Math.min(coords.bottom + 4, window.innerHeight - 220)
    }
  }
  function insertNote(path: string, mention = false) {
    const view = getView()
    if (!view || (mention && !popup.value)) return
    const selection = savedSelection ?? view.state.selection
    const from = mention ? popup.value!.from : selection.from
    const to = mention ? popup.value!.to : selection.to
    const label =
      !mention && from !== to
        ? view.state.doc.textBetween(from, to, ' ')
        : noteTitle(path)
    const mark = view.state.schema.marks.link!.create({
      href: noteLink(toValue(pathInput), path)
    })
    popup.value = null
    savedSelection = undefined
    view.dispatch(
      view.state.tr
        .replaceWith(from, to, view.state.schema.text(label, [mark]))
        .scrollIntoView()
    )
    view.focus()
  }
  function prepareLink() {
    const view = getView()
    if (!view) return
    savedSelection = view.state.selection
    popup.value = null
  }
  function handleKeyDown(_view: EditorView, event: KeyboardEvent) {
    if (!popup.value) return false
    if (event.key === 'Escape') {
      dismissed = popup.value.from
      popup.value = null
      return true
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      move(event.key === 'ArrowDown' ? 1 : -1)
      return true
    }
    if (event.key === 'Enter' && matches.value[active.value]) {
      insertNote(matches.value[active.value]!, true)
      return true
    }
    return false
  }
  return {
    popup,
    matches,
    active,
    updatePopup,
    handleKeyDown,
    prepareLink,
    insertLink: insertNote
  }
}
