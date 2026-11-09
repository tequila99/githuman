import { shallowRef, watch } from 'vue'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Selection } from '@milkdown/kit/prose/state'
import { findNoteMentionTrigger } from '@/utils/note-mention'
import {
  moveActive,
  type EditorLinkSource,
  type EditorLinkTarget
} from '@/utils/editor-links'

/** Mention popup and link insertion for the visual editor; the targets come from `source`. */
export function useEditorVisualLinks(
  getView: () => EditorView | undefined,
  source: EditorLinkSource
) {
  const popup = shallowRef<{
    from: number
    to: number
    query: string
    left: number
    top: number
  } | null>(null)
  const active = shallowRef(0)
  let savedSelection: Selection | undefined
  let dismissed: number | undefined

  watch(
    () => popup.value?.query ?? null,
    query => {
      active.value = 0
      source.setQuery(query)
    },
    { flush: 'sync' }
  )
  watch(
    () => source.matches.value.length,
    length => {
      active.value = Math.min(active.value, Math.max(0, length - 1))
    },
    { flush: 'sync' }
  )

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
  function insertTarget(target: EditorLinkTarget, mention = false) {
    const view = getView()
    if (!view || (mention && !popup.value)) return
    const selection = savedSelection ?? view.state.selection
    const from = mention ? popup.value!.from : selection.from
    const to = mention ? popup.value!.to : selection.to
    const label =
      !mention && from !== to
        ? view.state.doc.textBetween(from, to, ' ')
        : target.label
    const mark = view.state.schema.marks.link!.create({ href: target.href })
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
      active.value = moveActive(
        active.value,
        event.key === 'ArrowDown' ? 1 : -1,
        source.matches.value.length
      )
      return true
    }
    const chosen = source.matches.value[active.value]
    if (event.key === 'Enter' && chosen) {
      insertTarget(chosen, true)
      return true
    }
    return false
  }
  return {
    popup,
    active,
    updatePopup,
    handleKeyDown,
    prepareLink,
    insertTarget
  }
}
