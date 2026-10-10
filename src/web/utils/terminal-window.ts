export {
  WINDOW_MIN_WIDTH as TERMINAL_WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT as TERMINAL_WINDOW_MIN_HEIGHT,
  WINDOW_TOP as TERMINAL_WINDOW_TOP,
  RESIZE_EDGES
} from '@/constants/windows/constants'
export {
  windowSize as terminalWindowSize,
  clampWindowPosition as clampTerminalPosition,
  resizeWindow as resizeTerminalWindow
} from '@/utils/windows/window-geometry'
export type {
  WindowPoint,
  WindowSize,
  WindowRect,
  ResizeEdge
} from '@/types/windows/window'

export function terminalDirectoryTitle(title: string): string {
  const withoutPrompt = title.trim().replace(/\s*[$#%>]\s*$/, '')
  const hostPrefix = withoutPrompt.match(/^[^\s/]+@[^:]+:\s*(.+)$/)
  const directory = hostPrefix?.[1] ?? withoutPrompt
  return directory.replace(/\/+$/, '').split('/').at(-1) || directory
}
