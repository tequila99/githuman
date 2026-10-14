import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reactive, shallowRef } from 'vue'
import { useNotesNavigation } from '@/composables/notes/use-notes-navigation'
import type { NotesIndex } from '../../../../src/shared/notes/types.ts'

function setup() {
  const index: NotesIndex = { entries: [], storage: '', warning: null }
  const store = reactive({
    selected: 'work/first.md',
    index,
    error: '',
    async select(path: string) {
      store.selected = path
      return true
    }
  })
  return store
}

test('folder selection requires a successful flush and supplies the current creation folder', async () => {
  const store = setup()
  let allowed = true
  const nav = useNotesNavigation(store, {
    flush: async () => allowed,
    panel: null
  })
  assert.equal(nav.creationFolder.value, 'work')
  await nav.selectFolder('')
  assert.equal(nav.activeFolder.value, '')
  assert.equal(nav.creationFolder.value, '')
  await nav.selectFolder('docs')
  allowed = false
  await nav.selectFolder('blocked')
  assert.equal(nav.activeFolder.value, 'docs')
  allowed = true
  await nav.select('other/note.md')
  assert.equal(nav.activeFolder.value, null)
  assert.equal(nav.creationFolder.value, 'other')
})

test('a stale folder flush cannot replace a newer note selection', async () => {
  const store = setup()
  let release!: (value: boolean) => void
  const nav = useNotesNavigation(store, {
    flush: () =>
      new Promise<boolean>(resolve => {
        release = resolve
      }),
    panel: shallowRef(null)
  })
  const pending = nav.selectFolder('old')
  await nav.select('new.md')
  release(true)
  await pending
  assert.equal(nav.activeFolder.value, null)
  assert.equal(store.selected, 'new.md')
})

test('a late note response does not close the folder opened by a newer request', async () => {
  const store = setup()
  let release!: (value: boolean) => void
  store.select = () =>
    new Promise<boolean>(resolve => {
      release = resolve
    })
  const nav = useNotesNavigation(store, {
    flush: async () => true,
    panel: () => null
  })
  const pending = nav.select('late.md')
  await nav.selectFolder('new')
  release(true)
  await pending
  assert.equal(nav.activeFolder.value, 'new')
  nav.showNote()
  assert.equal(nav.activeFolder.value, null)
})

test('index paths and tag options react to replacing the index', () => {
  const store = setup()
  const nav = useNotesNavigation(store, {
    flush: async () => true,
    panel: null
  })
  store.index.entries = [
    { path: 'docs', folder: true, tags: [], error: null },
    { path: 'docs/a.md', folder: false, tags: ['z', 'cat'], error: null },
    { path: 'b.md', folder: false, tags: ['cat'], error: null }
  ]
  assert.deepEqual(nav.paths.value, ['docs/a.md', 'b.md'])
  assert.deepEqual(nav.tags.value, ['cat', 'z'])
  store.index = { entries: [], warning: null, storage: '' }
  assert.deepEqual(nav.paths.value, [])
  assert.deepEqual(nav.tags.value, [])
})

test('relative links navigate through the same selection guard', async () => {
  const store = setup()
  const nav = useNotesNavigation(store, {
    flush: async () => true,
    panel: null
  })
  await nav.follow('second.md')
  assert.equal(store.selected, 'work/second.md')
  await nav.follow('https://example.com')
  assert.equal(store.selected, 'work/second.md')
  store.select = async () => false
  await nav.follow('../blocked.md')
  assert.equal(store.selected, 'work/second.md')
})
