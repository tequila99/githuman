import type { WindowMode } from '@/types/windows/window'

// Physical key codes keep commands independent of the text input language.
export const WINDOW_SHORTCUTS = [
  'Ctrl+Meta+ArrowLeft',
  'Ctrl+Meta+ArrowRight',
  'Ctrl+Meta+ArrowUp',
  'Ctrl+Meta+ArrowDown',
  'Ctrl+Meta+KeyM',
  'Ctrl+Meta+KeyT',
  'Ctrl+Shift+Backquote'
]
export interface WindowCommandTarget {
  activeId: string | null
  toggleMode: (id: string, mode: Exclude<WindowMode, 'normal'>) => void
  minimize: (id: string) => void
  restoreLastMinimized: () => boolean
  minimizeAll: () => void
  createTerminal: () => void
  toggleTerminal: () => void
  terminalAvailable: () => boolean
}
export function dispatchWindowCommand(
  shortcut: string,
  target: WindowCommandTarget,
  modal: boolean
): boolean {
  if (modal) return false
  if (shortcut === 'Ctrl+Meta+KeyT' || shortcut === 'Ctrl+Shift+Backquote') {
    if (!target.terminalAvailable()) return false
    if (shortcut === 'Ctrl+Meta+KeyT') {
      target.createTerminal()
    } else {
      target.toggleTerminal()
    }
    return true
  }
  if (shortcut === 'Ctrl+Meta+KeyM') {
    target.minimizeAll()
    return true
  }
  const id = target.activeId
  if (!id) {
    return shortcut === 'Ctrl+Meta+ArrowUp' && target.restoreLastMinimized()
  }
  switch (shortcut) {
    case 'Ctrl+Meta+ArrowLeft':
      target.toggleMode(id, 'left')
      break
    case 'Ctrl+Meta+ArrowRight':
      target.toggleMode(id, 'right')
      break
    case 'Ctrl+Meta+ArrowUp':
      target.toggleMode(id, 'maximized')
      break
    case 'Ctrl+Meta+ArrowDown':
      target.minimize(id)
      break
    default:
      return false
  }
  return true
}
