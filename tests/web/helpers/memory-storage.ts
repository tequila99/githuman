import type { StorageBackend } from '@/utils/safe-storage'

/** A storage backend in memory, for `setStorageBackend()` in tests. */
export function memoryStorage(): StorageBackend & {
  items: Map<string, string>
} {
  const items = new Map<string, string>()
  return {
    items,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: key => void items.delete(key)
  }
}
