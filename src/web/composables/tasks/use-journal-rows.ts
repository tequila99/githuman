import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { JournalSearchEntry } from '@/api/types'

export function useJournalRows(
  items: MaybeRefOrGetter<readonly JournalSearchEntry[]>,
  grouped: MaybeRefOrGetter<boolean>,
  noTaskLabel: MaybeRefOrGetter<string>
) {
  return computed(() => {
    if (!toValue(grouped)) {
      return toValue(items).map(entry => ({
        kind: 'entry' as const,
        key: entry.id,
        entry
      }))
    }
    const groups = new Map<string, JournalSearchEntry[]>()
    for (const entry of toValue(items)) {
      const key = JSON.stringify([entry.storeId, entry.taskId])
      const entries = groups.get(key) ?? []
      entries.push(entry)
      groups.set(key, entries)
    }
    return [...groups].flatMap(([key, entries]) => [
      {
        kind: 'group' as const,
        key,
        label:
          entries[0]!.taskTitle ?? entries[0]!.taskId ?? toValue(noTaskLabel)
      },
      ...entries.map(entry => ({
        kind: 'entry' as const,
        key: entry.id,
        entry
      }))
    ])
  })
}
