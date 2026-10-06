import { format } from 'quasar'

// A smaller window cannot show a usable terminal and its toolbar.
export const TERMINAL_WINDOW_MIN_WIDTH = 240
export const TERMINAL_WINDOW_MIN_HEIGHT = 180
// The window stays below the app header, which has this height.
export const TERMINAL_WINDOW_TOP = 50
// The default window fits a command line without hiding the page.
const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 520
// The default window leaves this much of the viewport free.
const DEFAULT_MARGIN_X = 24
const DEFAULT_MARGIN_Y = 80

const { between } = format

export interface WindowSize {
  width: number
  height: number
}
export interface WindowPoint {
  x: number
  y: number
}
export type WindowRect = WindowPoint & WindowSize
export type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_EDGES: readonly ResizeEdge[] = [
  'n',
  'e',
  's',
  'w',
  'ne',
  'nw',
  'se',
  'sw'
]

// The space below the app header.
function available(viewport: WindowSize): WindowSize {
  return {
    width: viewport.width,
    height: Math.max(0, viewport.height - TERMINAL_WINDOW_TOP)
  }
}

// On a small screen, the minimum gives way to the available space.
function minimumSize(viewport: WindowSize): WindowSize {
  const space = available(viewport)
  return {
    width: Math.min(TERMINAL_WINDOW_MIN_WIDTH, space.width),
    height: Math.min(TERMINAL_WINDOW_MIN_HEIGHT, space.height)
  }
}

/** The window size: the saved size, or a default from the viewport. It always fits below the header. */
export function terminalWindowSize(
  preferred: WindowSize | null,
  viewport: WindowSize
): WindowSize {
  const size = preferred ?? {
    width: between(
      viewport.width - DEFAULT_MARGIN_X,
      TERMINAL_WINDOW_MIN_WIDTH,
      DEFAULT_WIDTH
    ),
    height: between(
      viewport.height - DEFAULT_MARGIN_Y,
      TERMINAL_WINDOW_MIN_HEIGHT,
      DEFAULT_HEIGHT
    )
  }
  const space = available(viewport)
  return {
    width: Math.min(size.width, space.width),
    height: Math.min(size.height, space.height)
  }
}

export function clampTerminalPosition(
  position: WindowPoint,
  size: WindowSize,
  viewport: WindowSize
): WindowPoint {
  return {
    x: between(position.x, 0, Math.max(0, viewport.width - size.width)),
    y: between(
      position.y,
      TERMINAL_WINDOW_TOP,
      Math.max(TERMINAL_WINDOW_TOP, viewport.height - size.height)
    )
  }
}

/** Moves the dragged edges by `delta`. The window keeps its minimum size and stays in the viewport. */
export function resizeTerminalWindow(
  start: WindowRect,
  edge: ResizeEdge,
  delta: WindowPoint,
  viewport: WindowSize
): WindowRect {
  const minimum = minimumSize(viewport)
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (edge.includes('w'))
    left = between(left + delta.x, 0, right - minimum.width)
  if (edge.includes('e'))
    right = between(right + delta.x, left + minimum.width, viewport.width)
  if (edge.includes('n'))
    top = between(top + delta.y, TERMINAL_WINDOW_TOP, bottom - minimum.height)
  if (edge.includes('s'))
    bottom = between(bottom + delta.y, top + minimum.height, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function terminalDirectoryTitle(title: string): string {
  const withoutPrompt = title.trim().replace(/\s*[$#%>]\s*$/, '')
  const hostPrefix = withoutPrompt.match(/^[^\s/]+@[^:]+:\s*(.+)$/)
  const directory = hostPrefix?.[1] ?? withoutPrompt
  return directory.replace(/\/+$/, '').split('/').at(-1) || directory
}
