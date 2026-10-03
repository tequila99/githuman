import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  NAV_STORAGE_KEY,
  initNavState,
  readDesktopOpen,
  resizeNavState,
  toggleNavState,
  writeDesktopOpen
} from '@/composables/use-nav-drawer'
import { setStorageBackend } from '@/utils/safe-storage'

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  setStorageBackend({
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key)
  })
  return store
}

afterEach(() => setStorageBackend(null))

describe('initNavState', () => {
  it('shows the drawer in a wide window and hides it in a narrow one', () => {
    assert.equal(initNavState(1024, true).visible, true)
    assert.equal(initNavState(1023, true).visible, false)
  })

  it('keeps a closed drawer closed at any width', () => {
    assert.equal(initNavState(1024, false).visible, false)
    assert.equal(initNavState(1023, false).visible, false)
  })
})

describe('readDesktopOpen', () => {
  it('reads open for a missing key and for garbage', () => {
    fakeStorage()
    assert.equal(readDesktopOpen(), true)
    fakeStorage({ [NAV_STORAGE_KEY]: 'banana' })
    assert.equal(readDesktopOpen(), true)
  })

  it('reads the saved choice', () => {
    fakeStorage({ [NAV_STORAGE_KEY]: 'closed' })
    assert.equal(readDesktopOpen(), false)
    fakeStorage({ [NAV_STORAGE_KEY]: 'open' })
    assert.equal(readDesktopOpen(), true)
  })

  it('reads open when the storage throws', () => {
    setStorageBackend({
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      }
    })
    assert.equal(readDesktopOpen(), true)
    assert.doesNotThrow(() => writeDesktopOpen(false))
  })
})

describe('resizeNavState', () => {
  it('restores an open drawer when the window gets wide again', () => {
    let state = initNavState(1400, true)
    state = resizeNavState(state, 800)
    assert.equal(state.visible, false)
    assert.equal(state.desktopOpen, true)
    state = resizeNavState(state, 1400)
    assert.equal(state.visible, true)
  })

  it('keeps a closed drawer closed after the user opened the narrow overlay', () => {
    let state = initNavState(1400, false)
    state = resizeNavState(state, 800)
    state = toggleNavState(state)
    assert.equal(state.visible, true)
    state = resizeNavState(state, 1400)
    assert.equal(state.visible, false)
    assert.equal(state.desktopOpen, false)
  })

  it('applies the saved choice after a start in a narrow window', () => {
    let state = initNavState(800, true)
    assert.equal(state.visible, false)
    state = resizeNavState(state, 1400)
    assert.equal(state.visible, true)
  })

  it('leaves the state alone while the mode stays the same', () => {
    const narrowOpen = toggleNavState(initNavState(800, true))
    assert.equal(resizeNavState(narrowOpen, 700), narrowOpen)
    const wideClosed = toggleNavState(initNavState(1400, true))
    assert.equal(resizeNavState(wideClosed, 1500), wideClosed)
  })
})

describe('toggleNavState', () => {
  it('changes the saved choice in a wide window', () => {
    const state = toggleNavState(initNavState(1400, true))
    assert.equal(state.visible, false)
    assert.equal(state.desktopOpen, false)
  })

  it('does not change the saved choice in a narrow window', () => {
    const state = toggleNavState(initNavState(800, true))
    assert.equal(state.visible, true)
    assert.equal(state.desktopOpen, true)
  })
})
