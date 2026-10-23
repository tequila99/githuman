import { getCurrentInstance, inject, type InjectionKey } from 'vue'

// Descendants pause heavy work while the owning pane retains its DOM and geometry.
export const PANE_VISIBLE: InjectionKey<() => boolean> = Symbol('pane-visible')

export function usePaneVisibility(): () => boolean {
  return getCurrentInstance() ? inject(PANE_VISIBLE, () => true) : () => true
}
