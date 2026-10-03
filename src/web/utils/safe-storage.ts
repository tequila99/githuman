import { LocalStorage } from 'quasar'

/** What `safeStorage` needs from a store; Quasar's `LocalStorage` fits it. */
export interface StorageBackend {
  getItem(key: string): unknown
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

let override: StorageBackend | null = null

/**
 * Tests only: under plain Node Quasar's `LocalStorage` is an empty no-op store, so a
 * fake `globalThis.localStorage` is never seen. `null` restores the real one.
 */
export function setStorageBackend(backend: StorageBackend | null): void {
  override = backend
}

// Read at call time, not copied at load: the override has to take effect.
const backend = (): StorageBackend => override ?? LocalStorage

/**
 * `localStorage` for conveniences (a remembered panel width, theme, active chat) that the
 * page must work without. Quasar only checks once, at load, that storage exists; a later
 * `setItem` can still throw (quota, storage turned off), so every call is guarded.
 *
 * Quasar writes values as `__q_strn|<value>`, which an older build reading the raw string
 * would not understand; values saved without that prefix are returned as they are.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      const value = backend().getItem(key)
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      backend().setItem(key, value)
    } catch {
      // Not remembered; the page works without it.
    }
  },
  remove(key: string): void {
    try {
      backend().removeItem(key)
    } catch {
      // Not remembered; the page works without it.
    }
  }
}
