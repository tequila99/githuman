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

test('layout toggles preserve normal geometry across special modes', () => {
  setActivePinia(createPinia())
  const store = useWindowStore()
  store.focus('preview')
  const state = store.ensure('preview')
  state.position = { x: 230, y: 120 }
  state.windowSize = { width: 640, height: 360 }
  for (const mode of ['left', 'right', 'maximized'] as const) {
    store.toggleMode('preview', mode)
    assert.equal(state.mode, mode)
  }
  assert.equal(state.maximized, true)
  store.toggleMode('preview', 'maximized')
  assert.equal(state.mode, 'normal')
  assert.equal(state.maximized, false)
  assert.deepEqual(state.position, { x: 230, y: 120 })
  assert.deepEqual(state.windowSize, { width: 640, height: 360 })
  store.toggleMode('preview', 'left')
  store.toggleMode('preview', 'left')
  assert.equal(state.mode, 'normal')
})

test('active window skips minimized and closed entries without losing stacking order', () => {
  setActivePinia(createPinia())
  const store = useWindowStore()
  store.focus('preview')
  store.focus('terminal')
  store.minimize('terminal')
  assert.equal(store.activeId, 'preview')
  assert.equal(store.isActive('preview'), true)
  assert.deepEqual(store.order, ['preview', 'terminal'])
  store.focus('terminal')
  store.close('terminal')
  assert.equal(store.activeId, 'preview')
  store.minimizeAll()
  assert.equal(store.activeId, null)
  assert.equal(store.ensure('preview').open, true)
  store.focus('preview')
  assert.equal(store.activeId, 'preview')
})

test('saved mode takes precedence and legacy maximized remains writable', () => {
  setStorageBackend({
    getItem: () =>
      JSON.stringify({
        version: 1,
        windows: {
          old: { position: { x: 20, y: 80 }, maximized: true },
          new: { position: { x: 40, y: 90 }, mode: 'left', maximized: true }
        }
      }),
    setItem: () => {},
    removeItem: () => {}
  })
  setActivePinia(createPinia())
  const store = useWindowStore()
  assert.equal(store.ensure('old').mode, 'maximized')
  const state = store.ensure('new')
  assert.equal(state.mode, 'left')
  assert.equal(state.maximized, false)
  state.maximized = true
  assert.equal(state.mode, 'maximized')
  state.maximized = false
  assert.equal(state.mode, 'normal')
})

test('restore selects the last minimized window and preserves its geometry', () => {
  setActivePinia(createPinia())
  const store = useWindowStore()
  assert.equal(store.restoreLastMinimized(), false)
  store.focus('preview')
  store.focus('terminal')
  const state = store.ensure('preview')
  state.position = { x: 41, y: 83 }
  state.windowSize = { width: 640, height: 360 }
  store.toggleMode('preview', 'left')
  store.minimize('terminal')
  assert.equal(store.restoreLastMinimized(), false)
  store.minimize('preview')
  assert.equal(store.restoreLastMinimized(), true)
  assert.equal(store.activeId, 'preview')
  assert.equal(state.mode, 'left')
  assert.deepEqual(state.position, { x: 41, y: 83 })
  assert.deepEqual(state.windowSize, { width: 640, height: 360 })
  store.close('preview')
  assert.equal(store.restoreLastMinimized(), true)
  assert.equal(store.activeId, 'terminal')
  store.close('terminal')
  assert.equal(store.restoreLastMinimized(), false)
})

test('restore after minimizing all selects the previously active window', () => {
  setActivePinia(createPinia())
  const store = useWindowStore()
  store.focus('preview')
  store.focus('terminal')
  store.minimizeAll()
  assert.equal(store.restoreLastMinimized(), true)
  assert.equal(store.activeId, 'terminal')
})
