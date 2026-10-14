import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import {
  useNoteEditorLinks,
  type NoteLinkEditor
} from '@/composables/notes/use-note-editor-links'

test('link selection is saved before opening the picker and insertion follows the current editor', () => {
  const calls: string[] = []
  const active = shallowRef<NoteLinkEditor | null>(null)
  const links = useNoteEditorLinks(
    () => active.value,
    () => {}
  )
  active.value = {
    prepareLink: () => {
      assert.equal(links.linkOpen.value, false)
      calls.push('visual:prepare')
    },
    insertLink: path => calls.push('visual:' + path)
  }
  links.prepareLink()
  assert.equal(links.linkOpen.value, true)
  links.insertLink('cat.md')
  active.value = {
    prepareLink: () => {},
    insertLink: path => calls.push('source:' + path)
  }
  links.insertLink('dog.md')
  assert.deepEqual(calls, ['visual:prepare', 'visual:cat.md', 'source:dog.md'])
})

test('plain editors, refs and an unmounted editor are supported', () => {
  const calls: string[] = []
  const editor: NoteLinkEditor = {
    prepareLink: () => {},
    insertLink: path => calls.push(path)
  }
  useNoteEditorLinks(editor, () => {}).insertLink('plain.md')
  const ref = shallowRef<NoteLinkEditor | null>(editor)
  const links = useNoteEditorLinks(ref, () => {})
  links.insertLink('ref.md')
  ref.value = null
  links.prepareLink()
  links.insertLink('ignored.md')
  assert.deepEqual(calls, ['plain.md', 'ref.md'])
})

test('ordinary and modified note clicks stay in the app; external links target a new tab', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  class FakeElement {
    attrs: Record<string, string> = {}
    closest() {
      return this
    }
    getAttribute(name: string) {
      return this.attrs[name] ?? null
    }
    setAttribute(name: string, value: string) {
      this.attrs[name] = value
    }
  }
  Object.defineProperty(globalThis, 'Element', {
    value: FakeElement,
    configurable: true
  })
  try {
    const visited: string[] = []
    const external: string[] = []
    const links = useNoteEditorLinks(
      null,
      href => visited.push(href),
      href => external.push(href)
    )
    const anchor = new FakeElement()
    anchor.attrs.href = 'folder/note.md'
    let prevented = 0
    const event = {
      type: 'click',
      button: 0,
      target: anchor,
      preventDefault() {
        prevented++
      },
      stopPropagation() {},
      ctrlKey: false,
      metaKey: false
    }
    links.follow(event as unknown as MouseEvent)
    links.follow({ ...event, ctrlKey: true } as unknown as MouseEvent)
    links.follow({
      ...event,
      type: 'auxclick',
      button: 1
    } as unknown as MouseEvent)
    assert.deepEqual(visited, [
      'folder/note.md',
      'folder/note.md',
      'folder/note.md'
    ])
    assert.equal(prevented, 3)
    anchor.attrs.href = 'https://example.com'
    links.follow(event as unknown as MouseEvent)
    assert.deepEqual(external, ['https://example.com'])
    assert.equal(prevented, 4)
    assert.equal(visited.length, 3)
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'Element', descriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'Element')
    }
  }
})
