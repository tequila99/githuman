import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { safeStorage, setStorageBackend } from '@/utils/safe-storage'

afterEach(() => setStorageBackend(null))

const quota = () => {
  throw new Error('quota')
}

function memory() {
  const store = new Map<string, unknown>()
  setStorageBackend({
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key)
  })
  return store
}

test('values are saved, read back and removed', () => {
  const store = memory()
  safeStorage.set('k', 'v')
  assert.equal(store.get('k'), 'v')
  assert.equal(safeStorage.get('k'), 'v')
  safeStorage.remove('k')
  assert.equal(safeStorage.get('k'), null)
})

test('only strings come back; anything else counts as missing', () => {
  const store = memory()
  store.set('n', 42)
  store.set('o', { a: 1 })
  assert.equal(safeStorage.get('n'), null)
  assert.equal(safeStorage.get('o'), null)
  assert.equal(safeStorage.get('missing'), null)
})

test('a store that throws never throws out of safeStorage', () => {
  setStorageBackend({ getItem: quota, setItem: quota, removeItem: quota })
  assert.equal(safeStorage.get('k'), null)
  assert.doesNotThrow(() => safeStorage.set('k', 'v'))
  assert.doesNotThrow(() => safeStorage.remove('k'))
})

test('under Node the default Quasar store is empty and harmless', () => {
  assert.equal(safeStorage.get('k'), null)
  assert.doesNotThrow(() => safeStorage.set('k', 'v'))
})
