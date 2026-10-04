import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useDiffStore } from '@/stores/diff-store'
import { cardStateKey } from '@/utils/card-state-key'
import { pathOf } from '@/utils/diff-file'

// Separates the card key from the slot name. A file path cannot hold a NUL character.
const KEY_SEPARATOR = '\u0000'

// Slots that belong to one review: selections, comment texts and open editors.
// The view mode and the wrap flag stay, because they do not depend on a review.
const REVIEW_SLOT_PREFIXES = ['pending:', 'draft:', 'busy:', 'edit:']

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

  function slotOf(key: string): string {
    return key.slice(key.indexOf(KEY_SEPARATOR) + 1)
  }

  /** Drops the slots whose name passes `match`, in every card. */
  function removeSlots(match: (slot: string) => boolean) {
    for (const key of Object.keys(entries.value)) {
      if (match(slotOf(key))) delete entries.value[key]
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

  // A draft written for one review must not go to the next one (Ctrl+Enter sends it to the
  // active review). The store watches the review itself, like it watches the diff.
  const activeReviewStore = useActiveReviewStore()
  watch(
    () => activeReviewStore.activeReview?.id,
    () =>
      removeSlots(slot =>
        REVIEW_SLOT_PREFIXES.some(prefix => slot.startsWith(prefix))
      )
  )

  // A deleted comment leaves its editor state behind. `edit:<id>` is also the draft key,
  // so the `draft:` and `busy:` slots carry the same suffix.
  watch(
    () => activeReviewStore.comments.map(comment => comment.id),
    (ids, previousIds) => {
      const current = new Set(ids)
      const removed = new Set(previousIds.filter(id => !current.has(id)))
      if (removed.size === 0) return
      removeSlots(slot =>
        [...removed].some(id =>
          [`edit:${id}`, `draft:edit:${id}`, `busy:edit:${id}`].includes(slot)
        )
      )
    }
  )

  return { get, set, remove, prune }
})
