import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampWidth,
  readStoredWidth,
  usePanelWidth
} from '@/composables/use-panel-width'
import { setStorageBackend } from '@/utils/safe-storage'
import { memoryStorage } from '../helpers/memory-storage'

const backend = memoryStorage()
const store = backend.items

function fakeStorage() {
  setStorageBackend(backend)
}

afterEach(() => {
  store.clear()
  setStorageBackend(null)
})

test('clampWidth rounds and keeps the width inside [min, max]', () => {
  assert.equal(clampWidth(100, 320, 900), 320)
  assert.equal(clampWidth(5000, 320, 900), 900)
  assert.equal(clampWidth(500.6, 320, 900), 501)
})

test('readStoredWidth ignores missing, garbage and unavailable storage', () => {
  assert.equal(readStoredWidth('k', 320, 900), null) // Quasar's store is empty under Node
  setStorageBackend({
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {},
    removeItem: () => {}
  })
  assert.equal(readStoredWidth('k', 320, 900), null)
  fakeStorage()
  assert.equal(readStoredWidth('k', 320, 900), null)
  store.set('k', 'abc')
  assert.equal(readStoredWidth('k', 320, 900), null)
  store.set('k', '50')
  assert.equal(readStoredWidth('k', 320, 900), 320)
})

function panel(max = 900) {
  return usePanelWidth({ key: 'w', initial: 440, min: 320, max: () => max })
}

test('starts from the saved width, else the initial one', () => {
  assert.equal(panel().width.value, 440)
  fakeStorage()
  store.set('w', '600')
  assert.equal(panel().width.value, 600)
})

test('dragging left widens the right-hand panel, from where the drag started', () => {
  fakeStorage()
  const p = panel()
  p.drag({ isFirst: true, offset: { x: 0 } })
  assert.equal(p.dragging.value, true)
  p.drag({ offset: { x: -100 } })
  assert.equal(p.width.value, 540)
  p.drag({ offset: { x: 60 } })
  assert.equal(p.width.value, 380)
  p.drag({ isFinal: true, offset: { x: -200 } })
  assert.equal(p.width.value, 640)
  assert.equal(p.dragging.value, false)
  assert.equal(store.get('w'), '640')

  // the next drag starts from the new width
  p.drag({ isFirst: true, offset: { x: 0 } })
  p.drag({ offset: { x: -10 } })
  assert.equal(p.width.value, 650)
})

test('the width never leaves [min, max], and max may shrink with the window', () => {
  fakeStorage()
  let max = 900
  const p = usePanelWidth({ key: 'w', initial: 440, min: 320, max: () => max })
  p.drag({ isFirst: true, offset: { x: 0 } })
  p.drag({ offset: { x: -5000 } })
  assert.equal(p.width.value, 900)
  p.drag({ offset: { x: 5000 } })
  assert.equal(p.width.value, 320)
  max = 500
  p.drag({ offset: { x: -5000 } })
  assert.equal(p.width.value, 500)
})

test('keyboard nudges widen/narrow in steps and are remembered', () => {
  fakeStorage()
  const p = panel()
  p.nudge('wider')
  assert.equal(p.width.value, 464)
  p.nudge('narrower', 100)
  assert.equal(p.width.value, 364)
  assert.equal(store.get('w'), '364')
})
