import {
  computed,
  inject,
  ref,
  type InjectionKey,
  type WritableComputedRef
} from 'vue'
import { useCardStateStore } from '@/stores/card-state-store'

/** `DiffFileCard` provides its state key. Outside a card (review page, browse mode) it is absent. */
export const CARD_STATE_KEY: InjectionKey<string | undefined> =
  Symbol('card-state-key')

export type CardState<T> = WritableComputedRef<T> & { reset(): void }

/**
 * Where a card state lives.
 * - `key`: in the card state store under this card key. A card passes its own key:
 *   a component cannot inject what it provides itself.
 * - `local`: in the component, even inside a card.
 * - Neither: in the store under the key of the enclosing card, or in the component
 *   outside a card.
 */
export interface CardStateOptions {
  key?: string
  local?: boolean
}

/**
 * A ref that lives in the card state store or in the component (see
 * `CardStateOptions`). `reset()` returns it to the initial value.
 */
export function useCardState<T>(
  slot: string,
  initial: () => T,
  options: CardStateOptions = {}
): CardState<T> {
  const cardKey = options.local
    ? undefined
    : (options.key ?? inject(CARD_STATE_KEY, undefined))
  if (cardKey === undefined) {
    const local = ref(initial())
    return Object.assign(
      computed({
        get: () => local.value,
        set: (value: T) => {
          local.value = value
        }
      }),
      {
        reset() {
          local.value = initial()
        }
      }
    )
  }

  const store = useCardStateStore()
  return Object.assign(
    computed({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a slot name always holds one type: its callers pick both together
      get: () => (store.get(cardKey, slot) as T | undefined) ?? initial(),
      set: (value: T) => store.set(cardKey, slot, value)
    }),
    {
      reset() {
        store.remove(cardKey, slot)
      }
    }
  )
}
