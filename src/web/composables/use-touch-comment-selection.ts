import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  toValue,
  watchEffect,
  type InjectionKey,
  type MaybeRefOrGetter
} from 'vue'
import type { DiffLineType } from '@/api/types'
import { CARD_STATE_KEY } from '@/composables/use-card-state'
import { useCardStateStore } from '@/stores/card-state-store'
import {
  checkAnchor,
  createAnchor,
  type AnchorLine,
  type CommentAnchor
} from '@/utils/comment-anchor'

// One selection toolbar belongs to the whole diff pane, rather than to virtual rows.
const TOUCH_SELECTION: InjectionKey<
  ReturnType<typeof createTouchCommentSelection>
> = Symbol('touch-comment-selection')

// The `pending:` prefix makes the card state store drop the slot with the review and the file.
const TOUCH_SLOT = 'pending:touch'

/**
 * An unconfirmed touch range of one card. It holds data only, so it outlives the
 * virtual rows and the hunk components that created it (ADR 0081, ADR 0084).
 */
export interface TouchSelection {
  path: string
  mode: 'diff' | 'full'
  column: string
  /** The first tapped line. The next tap in the same column extends the range from it. */
  origin: number
  originAnchor: CommentAnchor
  anchor: CommentAnchor
  /** Type of the first line of the range; `null` in a full file. */
  lineType: DiffLineType | null
  /** `confirming`: the owner of the card checks the lines and then creates the form. */
  phase: 'selecting' | 'confirming'
}

export interface TouchTap {
  path: string
  mode: 'diff' | 'full'
  column: string
  key: number
  /** Current rows of the tapped hunk or file. */
  lines: readonly AnchorLine[]
  lineTypeAt: (key: number) => DiffLineType | null
}

export function createTouchCommentSelection(
  options: {
    /** Brings an unmounted card back, so that its owner can confirm the range. */
    reveal?: (path: string) => void
  } = {}
) {
  const store = useCardStateStore()
  const activeKey = shallowRef<string | null>(null)
  const owners = new Map<string, number>()

  function read(cardKey: string): TouchSelection | null {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only this module writes the slot
    const value = store.get(cardKey, TOUCH_SLOT) as TouchSelection | undefined
    return value ?? null
  }
  function write(cardKey: string, value: TouchSelection) {
    store.set(cardKey, TOUCH_SLOT, value)
  }
  const selection = computed(() => {
    const cardKey = activeKey.value
    const value = cardKey === null ? null : read(cardKey)
    return cardKey !== null && value ? { cardKey, ...value } : null
  })

  function cancel(cardKey: string | null = activeKey.value) {
    if (cardKey === null) return
    store.remove(cardKey, TOUCH_SLOT)
    if (activeKey.value === cardKey) activeKey.value = null
  }
  function tap(cardKey: string, input: TouchTap) {
    const previous = read(cardKey)
    // A range stays inside one hunk: an origin in another hunk is absent from these rows.
    const continuing =
      previous !== null &&
      previous.phase === 'selecting' &&
      previous.mode === input.mode &&
      previous.column === input.column &&
      checkAnchor(previous.originAnchor, input.lines) === 'valid'
    if (activeKey.value !== null && activeKey.value !== cardKey) cancel()
    const origin = continuing ? previous.origin : input.key
    const start = Math.min(origin, input.key)
    const end = Math.max(origin, input.key)
    write(cardKey, {
      path: input.path,
      mode: input.mode,
      column: input.column,
      origin,
      originAnchor: continuing
        ? previous.originAnchor
        : createAnchor(input.column, input.key, input.key, input.lines),
      anchor: createAnchor(input.column, start, end, input.lines),
      lineType: input.lineTypeAt(start),
      phase: 'selecting'
    })
    activeKey.value = cardKey
  }
  /** Asks the owner to check the range against the current lines. A form does not appear before that. */
  function confirm() {
    const current = selection.value
    if (!current || current.phase === 'confirming') return
    const { cardKey, ...value } = current
    write(cardKey, { ...value, phase: 'confirming' })
    if (!owners.has(cardKey)) options.reveal?.(value.path)
  }
  /** A mounted card body registers itself, so `confirm` knows if it must bring the card back. */
  function registerOwner(cardKey: string): () => void {
    owners.set(cardKey, (owners.get(cardKey) ?? 0) + 1)
    return () => {
      const count = (owners.get(cardKey) ?? 1) - 1
      if (count > 0) {
        owners.set(cardKey, count)
      } else {
        owners.delete(cardKey)
      }
    }
  }
  return { selection, read, tap, cancel, confirm, registerOwner }
}

export type TouchCommentSelection = ReturnType<
  typeof createTouchCommentSelection
>

export function provideTouchCommentSelection(
  options: Parameters<typeof createTouchCommentSelection>[0] = {}
) {
  const selection = createTouchCommentSelection(options)
  provide(TOUCH_SELECTION, selection)
  return selection
}

export function useTouchCommentSelection() {
  return inject(TOUCH_SELECTION, undefined)
}

/**
 * The file level of a card (all hunks, or the full file) owns its touch range.
 * Only this level can tell "absent from one hunk" from "absent from the file".
 * The owner checks the range on current lines only: stale hunks or a refetch wait.
 */
export function useTouchSelectionOwner(options: {
  mode: 'diff' | 'full'
  /** The lines are the current version of the file, not stale lines during a refetch. */
  fresh: MaybeRefOrGetter<boolean>
  /** The anchor is valid in the current lines of the file. */
  valid: (anchor: CommentAnchor) => boolean
  /** Creates the comment form for a checked range. */
  commit: (selection: TouchSelection) => void
  /** The lines of a range that the user confirmed are gone or changed. */
  rejected: () => void
}) {
  const touch = useTouchCommentSelection()
  const cardKey = inject(CARD_STATE_KEY, undefined)
  if (!touch || cardKey === undefined) return
  onScopeDispose(touch.registerOwner(cardKey))
  watchEffect(() => {
    const selection = touch.read(cardKey)
    if (
      !selection ||
      selection.mode !== options.mode ||
      !toValue(options.fresh)
    ) {
      return
    }
    if (!options.valid(selection.anchor)) {
      touch.cancel(cardKey)
      if (selection.phase === 'confirming') options.rejected()
      return
    }
    if (selection.phase === 'confirming') {
      touch.cancel(cardKey)
      options.commit(selection)
    }
  })
}
