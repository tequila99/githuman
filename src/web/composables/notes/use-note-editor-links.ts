import { openURL } from 'quasar'
import { shallowRef, toValue, type MaybeRefOrGetter } from 'vue'

export interface NoteLinkEditor {
  prepareLink: () => void
  insertLink: (path: string) => void
}

export function useNoteEditorLinks(
  editor: MaybeRefOrGetter<NoteLinkEditor | null>,
  navigate: (href: string, occurrence?: number) => void,
  openExternal: (href: string) => void = href => {
    openURL(href, undefined, { noopener: true, noreferrer: true })
  }
) {
  const linkOpen = shallowRef(false)
  function prepareLink() {
    toValue(editor)?.prepareLink()
    linkOpen.value = true
  }
  function insertLink(path: string) {
    toValue(editor)?.insertLink(path)
  }
  function follow(event: MouseEvent) {
    if (event.type === 'auxclick' && event.button !== 1) return
    const anchor =
      event.target instanceof Element ? event.target.closest('a') : null
    const href = anchor?.getAttribute('href')
    if (!href) return
    if (href.startsWith('/api/notes/assets/')) {
      event.preventDefault()
      event.stopPropagation()
      openExternal(href)
      return
    }
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
      event.preventDefault()
      event.stopPropagation()
      openExternal(href)
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) return
    event.preventDefault()
    event.stopPropagation()
    const root = anchor?.closest('.note-pane')
    const anchors = root?.querySelectorAll?.('a')
    const occurrence = anchors
      ? [...anchors]
          .filter(item => item.getAttribute('href') === href)
          .indexOf(anchor!)
      : -1
    navigate(href, occurrence >= 0 ? occurrence : undefined)
  }
  return { linkOpen, prepareLink, insertLink, follow }
}
