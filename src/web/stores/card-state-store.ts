import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useDiffStore } from '@/stores/diff-store'
import { cardStateKey } from '@/utils/card-state-key'
import { pathOf } from '@/utils/diff-file'

// Separates the card key from the slot name. A file path cannot hold a NUL character.
const KEY_SEPARATOR = '\u0000'

/**
 * UI state of diff cards that must outlive the card component. The virtual
 * list unmounts a card when it leaves the window (ADR 0032).
 */
export const useCardStateStore = defineStore('card-state', () => {
  const entries = ref<Record<string, unknown>>({})

  function entryKey(cardKey: string, slot: string): string {
    return `${cardKey}${KEY_SEPARATOR}${slot}`
  }

  function get(cardKey: string, slot: string): unknown {
    return entries.value[entryKey(cardKey, slot)]
  }

  function set(cardKey: string, slot: string, value: unknown) {
    entries.value[entryKey(cardKey, slot)] = value
  }

  function remove(cardKey: string, slot: string) {
    delete entries.value[entryKey(cardKey, slot)]
  }

  /** Drops the state of cards whose file left the diff. */
  function prune(validCardKeys: ReadonlySet<string>) {
    for (const key of Object.keys(entries.value)) {
      const cardKey = key.slice(0, key.indexOf(KEY_SEPARATOR))
      if (!validCardKeys.has(cardKey)) delete entries.value[key]
    }
  }

  // A file that left the diff takes its drafts and view mode with it. The store watches
  // the diff itself, so this works while the Changes panel is not on screen.
  // Before the first good fetch, the lists are empty: a prune then would drop every draft.
  const diffStore = useDiffStore()
  watch(
    () =>
      [
        diffStore.loaded,
        diffStore.stagedFiles,
        diffStore.unstagedFiles
      ] as const,
    ([loaded, staged, unstaged]) => {
      if (!loaded) return
      prune(
        new Set([
          ...staged.map(file => cardStateKey('staged', pathOf(file))),
          ...unstaged.map(file => cardStateKey('unstaged', pathOf(file)))
        ])
      )
    },
    { immediate: true }
  )

  return { get, set, remove, prune }
})
