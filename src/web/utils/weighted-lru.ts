/**
 * Map that drops the least recently used entries when the total weight passes
 * `maxWeight`. The newest entry always stays, even if it is heavier than the limit.
 * We do not use `lru-cache`: it rejects an entry heavier than `maxSize`, so the
 * largest open file would not be cached and would load again on every mount.
 */
export function createWeightedLru<K, V>(
  maxWeight: number,
  weigh: (value: V) => number
) {
  const entries = new Map<K, { value: V; weight: number }>()
  let total = 0

  function get(key: K): V | undefined {
    const entry = entries.get(key)
    if (!entry) return undefined
    // Re-insert: a Map iterates in insertion order, so the first key is the oldest.
    entries.delete(key)
    entries.set(key, entry)
    return entry.value
  }

  function set(key: K, value: V) {
    remove(key)
    const weight = weigh(value)
    entries.set(key, { value, weight })
    total += weight
    for (const [oldest, entry] of entries) {
      if (total <= maxWeight || entries.size <= 1) break
      entries.delete(oldest)
      total -= entry.weight
    }
  }

  function remove(key: K) {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    total -= entry.weight
  }

  return { get, set, remove, size: () => entries.size }
}
