import { computed, nextTick, ref } from 'vue'
import { useQuasar } from 'quasar'
import { safeStorage } from '@/utils/safe-storage'

/** Quasar's default for `q-drawer`: a window this wide or narrower counts as narrow. */
export const NAV_BREAKPOINT = 1023
/** Where the open/closed choice for a wide window is remembered between page loads. */
export const NAV_STORAGE_KEY = 'githuman.navDrawerOpen'

/**
 * `desktopOpen` is the user's choice for a wide window; only it is saved.
 * `visible` is what the drawer shows now. A narrow window changes `visible`
 * and leaves the choice alone.
 */
export interface NavState {
  desktop: boolean
  desktopOpen: boolean
  visible: boolean
}

export function isDesktopWidth(width: number): boolean {
  return width > NAV_BREAKPOINT
}

/** Open unless the user closed it: a missing or unreadable value means open. */
export function readDesktopOpen(): boolean {
  return safeStorage.get(NAV_STORAGE_KEY) !== 'closed'
}

export function writeDesktopOpen(open: boolean): void {
  safeStorage.set(NAV_STORAGE_KEY, open ? 'open' : 'closed')
}

export function initNavState(width: number, desktopOpen: boolean): NavState {
  const desktop = isDesktopWidth(width)
  return { desktop, desktopOpen, visible: desktop && desktopOpen }
}

/**
 * Only a change between wide and narrow acts. A resize inside one mode keeps
 * what the user did there (a closed wide drawer, an open narrow overlay).
 */
export function resizeNavState(state: NavState, width: number): NavState {
  const desktop = isDesktopWidth(width)
  if (desktop === state.desktop) return state
  return { ...state, desktop, visible: desktop && state.desktopOpen }
}

/** The header button. In a wide window it also changes the saved choice. */
export function toggleNavState(state: NavState): NavState {
  const visible = !state.visible
  return {
    ...state,
    visible,
    desktopOpen: state.desktop ? visible : state.desktopOpen
  }
}

/**
 * State of the left menu drawer. `open` is the `q-drawer` model, `toggle` the
 * header button, `onResize` the `q-layout` resize event.
 */
export function useNavDrawer() {
  const $q = useQuasar()
  const nav = ref(initNavState($q.screen.width, readDesktopOpen()))

  // Quasar also writes here (it closes a narrow drawer after a route change). Those
  // writes change what is shown, not what the user chose, so nothing is saved.
  const open = computed({
    get: () => nav.value.visible,
    set: visible => {
      nav.value = { ...nav.value, visible }
    }
  })

  function toggle() {
    nav.value = toggleNavState(nav.value)
    if (nav.value.desktop) writeDesktopOpen(nav.value.desktopOpen)
  }

  async function onResize(size: { width: number }) {
    const next = resizeNavState(nav.value, size.width)
    if (next === nav.value) return
    nav.value = next
    // Quasar restores its own drawer state when the mode changes. Wait for it,
    // then apply the saved choice, unless another change came in meanwhile.
    await nextTick()
    if (nav.value.desktop === next.desktop) {
      nav.value = { ...nav.value, visible: next.visible }
    }
  }

  return { open, toggle, onResize }
}
