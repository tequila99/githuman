import { type EditorNode } from './mention-editor'
export function isChip(node: Node | null | undefined): node is HTMLElement {
  return node instanceof HTMLElement && node.classList.contains('agent-mention')
}

export function nodesOf(parent: Node): EditorNode[] {
  const nodes: EditorNode[] = []
  for (const child of parent.childNodes) {
    if (child instanceof Text) {
      nodes.push({ type: 'text', text: child.data })
    } else if (isChip(child)) {
      nodes.push({ type: 'mention', path: child.dataset.path ?? '' })
    } else if (child instanceof HTMLBRElement) {
      nodes.push({ type: 'br' })
    } else if (child instanceof HTMLElement) {
      nodes.push({ type: 'block', children: nodesOf(child) })
    }
  }
  return nodes
}

export function createChip(path: string): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'agent-mention'
  chip.contentEditable = 'false'
  chip.dataset.path = path
  chip.title = path
  const label = document.createElement('span')
  label.className = 'agent-mention__label'
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'agent-mention__remove'
  remove.tabIndex = -1
  remove.textContent = '×'
  chip.append(label, remove)
  return chip
}

export function caretAnchor(
  root: HTMLElement | null,
  width: number
): { left: number; bottom: number } {
  const sel = window.getSelection()
  let rect: DOMRect | undefined
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange()
    range.collapse(true)
    rect = range.getBoundingClientRect()
  }
  // An empty range reports an all-zero rectangle in some browsers.
  if (!rect || (rect.top === 0 && rect.height === 0)) {
    rect = root?.getBoundingClientRect()
  }
  const top = rect?.top ?? window.innerHeight
  const left = rect?.left ?? 8
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    bottom: window.innerHeight - top + 6
  }
}

export function chipBeforeCaret(root: HTMLElement | null): HTMLElement | null {
  const sel = window.getSelection()
  if (
    !sel ||
    !sel.isCollapsed ||
    !root ||
    !sel.focusNode ||
    !root.contains(sel.focusNode)
  )
    return null
  const { focusNode: node, focusOffset: offset } = sel
  if (node instanceof Text && offset === 0) {
    const before = node.previousSibling
    return isChip(before) ? before : null
  }
  if (node === root && offset > 0) {
    const before = root?.childNodes[offset - 1]
    return isChip(before) ? before : null
  }
  return null
}

export function removeButtonOf(
  root: HTMLElement | null,
  event: Event
): HTMLElement | null {
  const target = event.target instanceof Element ? event.target : null
  const button = target?.closest('.agent-mention__remove')
  const chip = button?.closest('.agent-mention')
  return isChip(chip) && root?.contains(chip) ? chip : null
}

export interface EditorTrigger {
  node: Text
  start: number
  end: number
  text: string
}
export function validTrigger(
  root: HTMLElement | null,
  at: EditorTrigger
): boolean {
  return (
    !!root?.contains(at.node) &&
    at.start >= 0 &&
    at.end <= at.node.length &&
    at.end > at.start &&
    at.node.data.slice(at.start, at.end) === at.text
  )
}
export function insertMention(
  root: HTMLElement | null,
  at: EditorTrigger,
  path: string
): boolean {
  if (!validTrigger(root, at)) return false
  const range = document.createRange()
  range.setStart(at.node, at.start)
  range.setEnd(at.node, at.end)
  range.deleteContents()
  const chip = createChip(path)
  range.insertNode(chip)
  // Firefox needs a text node after a non-editable chip for a usable caret.
  const space = document.createTextNode(' ')
  chip.after(space)
  const caret = document.createRange()
  caret.setStart(space, 1)
  caret.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(caret)
  return true
}
