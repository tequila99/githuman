import {
  onBeforeUnmount,
  onDeactivated,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { findMentionTrigger } from '@/utils/mention-editor'
import {
  caretAnchor,
  insertMention,
  validTrigger,
  type EditorTrigger
} from '@/utils/mention-editor-dom'
import { useMentionSearch } from './use-mention-search'

// Match the existing popup width when clamping it to the viewport.
const POPUP_WIDTH = 340
interface PopupState {
  items: string[]
  active: number
  left: number
  bottom: number
}

export function useMentionAutocomplete(
  root: MaybeRefOrGetter<HTMLElement | null>,
  options: {
    disabled: MaybeRefOrGetter<boolean | undefined>
    onChanged: () => void
  }
) {
  const popup = shallowRef<PopupState | null>(null)
  let trigger: EditorTrigger | null = null
  const { search, cancel } = useMentionSearch({
    onResult(files) {
      if (
        trigger &&
        !toValue(options.disabled) &&
        validTrigger(toValue(root), trigger)
      ) {
        popup.value = {
          items: files,
          active: 0,
          ...caretAnchor(toValue(root), POPUP_WIDTH)
        }
      } else {
        closePopup()
      }
    },
    onError: closePopup
  })
  function closePopup(): void {
    cancel()
    trigger = null
    popup.value = null
  }
  function updateTrigger(): void {
    const sel = window.getSelection()
    const node = sel?.focusNode
    if (
      toValue(options.disabled) ||
      !sel ||
      !sel.isCollapsed ||
      !(node instanceof Text) ||
      !toValue(root)?.contains(node)
    ) {
      closePopup()
      return
    }
    const found = findMentionTrigger(node.data.slice(0, sel.focusOffset))
    if (!found) {
      closePopup()
      return
    }
    trigger = {
      node,
      start: found.start,
      end: sel.focusOffset,
      text: node.data.slice(found.start, sel.focusOffset)
    }
    search(found.query)
  }
  function pick(index: number): void {
    const path = popup.value?.items[index]
    if (toValue(options.disabled) || path === undefined || !trigger) {
      closePopup()
      return
    }
    const inserted = insertMention(toValue(root), trigger, path)
    closePopup()
    if (inserted) options.onChanged()
  }
  function handleKeydown(event: KeyboardEvent): boolean {
    const list = popup.value
    if (!list) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.items.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1
        popup.value = {
          ...list,
          active: (list.active + step + list.items.length) % list.items.length
        }
      }
      return true
    }
    if (
      (event.key === 'Tab' || event.key === 'Enter') &&
      !event.shiftKey &&
      list.items.length > 0
    ) {
      event.preventDefault()
      pick(list.active)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closePopup()
      return true
    }
    return false
  }
  watch(
    () => toValue(options.disabled),
    disabled => {
      if (disabled) closePopup()
    },
    { flush: 'sync' }
  )
  watch(() => toValue(root), closePopup, { flush: 'sync' })
  onBeforeUnmount(closePopup)
  onDeactivated(closePopup)
  return { popup, closePopup, updateTrigger, pick, handleKeydown }
}
