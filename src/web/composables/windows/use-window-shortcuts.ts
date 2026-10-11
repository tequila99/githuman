import { nextTick, watch } from 'vue'
import { useKeyboardShortcut } from 'quasar'
import { TERMINAL_WINDOW_ID } from '@/constants/windows/constants'
import { useWindowStore } from '@/stores/windows/window-store'
import { useApplicationRegistry } from '@/stores/windows/application-registry'
import {
  dispatchWindowCommand,
  WINDOW_SHORTCUTS
} from '@/utils/windows/window-commands'
import { focusWindow } from '@/utils/windows/window-elements'

export function useWindowShortcuts() {
  const windows = useWindowStore()
  const registry = useApplicationRegistry()
  const terminal = () =>
    registry.applications.find(app => app.id === TERMINAL_WINDOW_ID)
  useKeyboardShortcut(
    WINDOW_SHORTCUTS,
    async (event, shortcut) => {
      let restored = false
      const handled = dispatchWindowCommand(
        shortcut,
        {
          activeId: windows.activeId,
          toggleMode: windows.toggleMode,
          minimize: windows.minimize,
          minimizeAll: windows.minimizeAll,
          restoreLastMinimized: () => {
            restored = windows.restoreLastMinimized()
            return restored
          },
          createTerminal: () => {
            void terminal()?.create?.()
          },
          toggleTerminal: () => {
            const state = windows.ensure(TERMINAL_WINDOW_ID)
            if (state.open && !state.minimized) {
              windows.minimize(TERMINAL_WINDOW_ID)
            } else {
              void terminal()?.activate()
            }
          },
          terminalAvailable: () => terminal()?.availability().enabled === true
        },
        document.querySelector('[role="dialog"][aria-modal="true"]') !== null
      )
      if (handled) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (restored) {
        await nextTick()
        focusWindow(windows.activeId)
      }
    },
    { capture: true, preventDefault: false }
  )
  watch(
    () => windows.activeId,
    async (id, previous) => {
      // Pointer focus must not move the caret out of the clicked field.
      const state = previous ? windows.windows[previous] : null
      if (state && (!state.open || state.minimized)) {
        await nextTick()
        focusWindow(id)
      }
    }
  )
}

/** Keep application-specific close behavior, including terminal confirmation. */
export function useWindowCloseShortcut(id: string, requestClose: () => void) {
  const windows = useWindowStore()
  useKeyboardShortcut(
    'Ctrl+Meta+KeyW',
    event => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      requestClose()
    },
    () => ({
      capture: true,
      preventDefault: false,
      disabled: !windows.isActive(id)
    })
  )
}
