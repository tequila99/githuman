import { format } from 'quasar'
import {
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_TOP
} from '@/constants/windows/constants'
import type {
  WindowPoint,
  WindowSize,
  WindowRect,
  ResizeEdge
} from '@/types/windows/window'

// The default window fits a command line without hiding the page.
const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 520
// The default window leaves this much of the viewport free.
const DEFAULT_MARGIN_X = 24
const DEFAULT_MARGIN_Y = 80

const { between } = format

// The space below the app header.
function available(viewport: WindowSize): WindowSize {
  return {
    width: viewport.width,
    height: Math.max(0, viewport.height - WINDOW_TOP)
  }
}

// On a small screen, the minimum gives way to the available space.
function minimumSize(viewport: WindowSize, minimum: WindowSize): WindowSize {
  const space = available(viewport)
  return {
    width: Math.min(minimum.width, space.width),
    height: Math.min(minimum.height, space.height)
  }
}

/** The window size: the saved size, or a default from the viewport. It always fits below the header. */
export function windowSize(
  preferred: WindowSize | null,
  viewport: WindowSize
): WindowSize {
  const size = preferred ?? {
    width: between(
      viewport.width - DEFAULT_MARGIN_X,
      WINDOW_MIN_WIDTH,
      DEFAULT_WIDTH
    ),
    height: between(
      viewport.height - DEFAULT_MARGIN_Y,
      WINDOW_MIN_HEIGHT,
      DEFAULT_HEIGHT
    )
  }
  const space = available(viewport)
  return {
    width: Math.min(size.width, space.width),
    height: Math.min(size.height, space.height)
  }
}

export function clampWindowPosition(
  position: WindowPoint,
  size: WindowSize,
  viewport: WindowSize
): WindowPoint {
  return {
    x: between(position.x, 0, Math.max(0, viewport.width - size.width)),
    y: between(
      position.y,
      WINDOW_TOP,
      Math.max(WINDOW_TOP, viewport.height - size.height)
    )
  }
}

/** Moves the dragged edges by `delta`. The window keeps its minimum size and stays in the viewport. */
export function resizeWindow(
  start: WindowRect,
  edge: ResizeEdge,
  delta: WindowPoint,
  viewport: WindowSize,
  constraints: WindowSize = {
    width: WINDOW_MIN_WIDTH,
    height: WINDOW_MIN_HEIGHT
  }
): WindowRect {
  const minimum = minimumSize(viewport, constraints)
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (edge.includes('w'))
    left = between(left + delta.x, 0, right - minimum.width)
  if (edge.includes('e'))
    right = between(right + delta.x, left + minimum.width, viewport.width)
  if (edge.includes('n'))
    top = between(top + delta.y, WINDOW_TOP, bottom - minimum.height)
  if (edge.includes('s'))
    bottom = between(bottom + delta.y, top + minimum.height, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
