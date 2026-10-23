import {
  computed,
  getCurrentInstance,
  inject,
  provide,
  toValue,
  type InjectionKey,
  type MaybeRefOrGetter
} from 'vue'
import { rowHeight } from '@/utils/row-segments'

// The layout owns the narrow state. Code outside the layout, and tests, see a wide workspace.
const NARROW_WORKSPACE: InjectionKey<() => boolean> = Symbol('narrow-workspace')

export function provideNarrowWorkspace(narrow: () => boolean) {
  provide(NARROW_WORKSPACE, narrow)
}

/** Height of one code row: commentable rows are taller in the narrow workspace (ADR 0083). */
export function useRowHeight(
  commentable: MaybeRefOrGetter<boolean | undefined>
) {
  const narrow = getCurrentInstance()
    ? inject(NARROW_WORKSPACE, () => false)
    : () => false
  return computed(() => rowHeight(narrow() && Boolean(toValue(commentable))))
}
