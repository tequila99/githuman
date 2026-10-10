import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useWindowStore } from '@/stores/windows/window-store'
import { setStorageBackend } from '@/utils/safe-storage'

afterEach(() => setStorageBackend(null))
test('window state and dock survive reload without restoring server data', () => {
  const saved = new Map<string, string>()
  setStorageBackend({
    getItem: key => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  })
  setActivePinia(createPinia())
  const store = useWindowStore()
  store.focus('custom')
  Object.assign(store.ensure('custom'), {
    maximized: true,
    minimized: true,
    position: { x: 41, y: 83 }
  })
  store.dock.edge = 'right'
  store.remember()
  setActivePinia(createPinia())
  const restored = useWindowStore()
  assert.equal(restored.ensure('custom').maximized, true)
  assert.equal(restored.ensure('custom').minimized, true)
  assert.deepEqual(restored.ensure('custom').position, { x: 41, y: 83 })
  assert.equal(restored.dock.edge, 'right')
  restored.focus('custom')
  assert.equal(restored.ensure('custom').minimized, false)
  assert.deepEqual(restored.order, ['custom'])
  restored.close('custom')
  assert.equal(restored.ensure('custom').open, false)
})
test('invalid preferences and unavailable storage do not block windows', () => {
  setStorageBackend({
    getItem: () => '{broken',
    setItem: () => {
      throw new Error('full')
    },
    removeItem: () => {}
  })
  setActivePinia(createPinia())
  const store = useWindowStore()
  assert.doesNotThrow(() => store.focus('preview'))
  assert.equal(store.dock.edge, 'bottom')
  for (const id of ['', '__proto__', 'constructor', 'prototype'])
    assert.throws(() => store.ensure(id), /Invalid window id/)
})

test('default positions belong to individual windows', () => {
  setActivePinia(createPinia())
  const store = useWindowStore()
  const first = store.ensure('first')
  const second = store.ensure('second')
  first.position.x += 10
  assert.notEqual(first.position.x, second.position.x)
})

test('legacy dock visibility preferences are ignored', () => {
  setStorageBackend({
    getItem: () =>
      JSON.stringify({ version: 1, dock: { visible: false, edge: 'left' } }),
    setItem: () => {},
    removeItem: () => {}
  })
  setActivePinia(createPinia())
  const store = useWindowStore()
  assert.equal(store.dock.edge, 'left')
  assert.equal(Object.hasOwn(store.dock, 'visible'), false)
})
