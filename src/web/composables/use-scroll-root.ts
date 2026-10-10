import { inject, type InjectionKey } from 'vue'

/**
 * `DiffPanel` provides the element that scrolls its cards. The root of an
 * `IntersectionObserver` must be that element: with the default root, a
 * `rootMargin` does not reach past the clip of the scroll area.
 */
export const SCROLL_ROOT_KEY: InjectionKey<() => Element | null> =
  Symbol('scroll-root')

/** Finds the scroll element for `from`, or null when no Quasar scroll area holds it. */
export function useScrollRoot(): (from?: Element | null) => Element | null {
  const provided = inject(SCROLL_ROOT_KEY, undefined)
  return from =>
    provided?.() ?? from?.closest('.q-scrollarea__container') ?? null
}
