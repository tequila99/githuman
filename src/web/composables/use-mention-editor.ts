import { shallowRef, toRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { clipboardImages } from '@/utils/attachments'
import {
  mentionLabel,
  serializeEditor,
  type SerializedMessage
} from '@/utils/mention-editor'
import {
  nodesOf,
  chipBeforeCaret,
  removeButtonOf
} from '@/utils/mention-editor-dom'
import { useMentionAutocomplete } from './use-mention-autocomplete'
import { spokenTextToInsert } from '@/utils/speech'

interface EditorOptions {
  disabled: MaybeRefOrGetter<boolean | undefined>
  cycleMode: MaybeRefOrGetter<boolean | undefined>
  onSubmit: () => void
  onCycleMode: () => void
  onEmptyChange: (empty: boolean) => void
  onFiles: (files: File[]) => void
}
export function useMentionEditor(
  target: MaybeRefOrGetter<HTMLDivElement | null>,
  options: EditorOptions
) {
  const { t, locale } = useI18n()
  const root = toRef(target)
  const empty = shallowRef(true)
  const { popup, closePopup, updateTrigger, pick, handleKeydown } =
    useMentionAutocomplete(target, { disabled: options.disabled, onChanged })
  function serialize(): SerializedMessage {
    return root.value
      ? serializeEditor(nodesOf(root.value))
      : { text: '', files: [] }
  }

  function chips(): HTMLElement[] {
    return root.value
      ? [...root.value.querySelectorAll<HTMLElement>('.agent-mention')]
      : []
  }

  /** Labels depend on the other chips (a clash adds the folder), so they are recomputed as a set. */
  function refreshChips(): void {
    const current = chips()
    const all = current.map(chip => chip.dataset.path ?? '')
    for (const chip of current) {
      const path = chip.dataset.path ?? ''
      const label = mentionLabel(path, all)
      const text = chip.querySelector('.agent-mention__label')
      if (text) text.textContent = `@${label}`
      chip
        .querySelector('.agent-mention__remove')
        ?.setAttribute('aria-label', t('agent.mention.remove', { name: label }))
    }
  }

  function updateEmpty(): void {
    const nowEmpty = serialize().text === ''
    // A browser leaves a stray <br> behind after the last character is deleted.
    if (nowEmpty && root.value && chips().length === 0)
      root.value.replaceChildren()
    if (nowEmpty !== empty.value) {
      empty.value = nowEmpty
      options.onEmptyChange(nowEmpty)
    }
  }

  function onChanged(): void {
    refreshChips()
    updateEmpty()
  }
  function removeChip(chip: HTMLElement): void {
    chip.remove()
    refreshChips()
    updateEmpty()
  }

  function onInput(): void {
    if (toValue(options.disabled)) return
    updateEmpty()
    updateTrigger()
  }

  function onKeydown(event: KeyboardEvent): void {
    // Enter that confirms an IME composition must neither send nor pick.
    if (event.isComposing || event.keyCode === 229) return
    if (toValue(options.disabled) || handleKeydown(event)) return
    if (event.key === 'Tab' && event.shiftKey && toValue(options.cycleMode)) {
      event.preventDefault()
      options.onCycleMode()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        // `execCommand` is deprecated, but it is the only way to edit a
        // contenteditable and keep the browser's undo stack.
        document.execCommand('insertLineBreak')
      } else {
        options.onSubmit()
      }
    } else if (event.key === 'Backspace') {
      const chip = chipBeforeCaret(root.value)
      if (chip) {
        event.preventDefault()
        removeChip(chip)
      }
    }
  }

  function onKeyup(event: KeyboardEvent): void {
    // Typing is handled by `input`; only caret moves need a fresh look here.
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      updateTrigger()
    }
  }

  function onPaste(event: ClipboardEvent): void {
    if (toValue(options.disabled)) {
      event.preventDefault()
      return
    }
    const images = clipboardImages(event.clipboardData)
    if (images.length > 0) {
      event.preventDefault()
      options.onFiles(images)
      return
    }
    const text = event.clipboardData?.getData('text/plain')
    if (text === undefined) return
    // Pasted markup would bring styles and elements the message has no use for.
    event.preventDefault()
    document.execCommand('insertText', false, text)
  }

  function onMousedown(event: MouseEvent): void {
    // Keep the caret where it is; the click removes the chip.
    if (removeButtonOf(root.value, event)) event.preventDefault()
  }

  function onClick(event: MouseEvent): void {
    if (toValue(options.disabled)) return
    const chip = removeButtonOf(root.value, event)
    if (chip) {
      removeChip(chip)
      root.value?.focus()
      return
    }
    updateTrigger()
  }

  function focus(): void {
    root.value?.focus()
  }

  function clear(): void {
    if (root.value) root.value.replaceChildren()
    closePopup()
    updateEmpty()
  }

  // Where the caret was when voice input started (#82). The insert goes there
  // when the editor has no focus at the release, for example after a key press.
  let savedCaret: Range | null = null

  function caretRange(): Range | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    return root.value?.contains(range.startContainer) ? range : null
  }

  function saveCaret(): void {
    savedCaret = caretRange()?.cloneRange() ?? null
  }

  /**
   * Inserts recognized speech at the caret, with spaces where it touches words.
   * With `takeFocus`, an editor without focus gets it back first: then the caret
   * goes after the text and the insert is one undo step. A hidden chat must
   * not take the focus, so it inserts the node directly.
   */
  function insertText(text: string, takeFocus: boolean): void {
    const editor = root.value
    if (!editor || toValue(options.disabled) || text === '') return
    closePopup()
    const focused = document.activeElement === editor
    let range = (focused ? caretRange() : null) ?? savedCaret
    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    // The selected text is replaced, so it is not a neighbour of the insert.
    const before = range.cloneRange()
    before.collapse(true)
    before.setStart(editor, 0)
    const after = range.cloneRange()
    after.collapse(false)
    after.setEnd(editor, editor.childNodes.length)
    const insert = spokenTextToInsert(before.toString(), after.toString(), text)
    savedCaret = null
    if (focused || takeFocus) {
      if (!focused) {
        editor.focus()
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      // Like a paste: `execCommand` keeps the undo stack and fires `input`.
      document.execCommand('insertText', false, insert)
      return
    }
    const node = document.createTextNode(insert)
    range.deleteContents()
    range.insertNode(node)
    onChanged()
  }

  /** Types an `@` at the caret, which opens the file list. */
  function startMention(): void {
    if (toValue(options.disabled)) return
    focus()
    document.execCommand('insertText', false, '@')
    updateTrigger()
  }

  watch(locale, refreshChips)
  return {
    empty,
    popup,
    serialize,
    clear,
    focus,
    startMention,
    saveCaret,
    insertText,
    closePopup,
    pick,
    onInput,
    onKeydown,
    onKeyup,
    onPaste,
    onMousedown,
    onClick
  }
}
