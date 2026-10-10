import type { DockEdge } from '@/types/windows/window'
import type { WindowPoint, WindowSize } from '@/types/windows/window'

// Release near an edge docks the panel without requiring an exact drop.
const SNAP_DISTANCE = 24
// Keep the panel border and shadow clear of the browser edges.
const EDGE_GAP = 8

function dockBounds(size: WindowSize, viewport: WindowSize) {
  const availableX = Math.max(0, viewport.width - size.width)
  const availableY = Math.max(0, viewport.height - size.height)
  const gapX = Math.min(EDGE_GAP, availableX / 2)
  const gapY = Math.min(EDGE_GAP, availableY / 2)
  return {
    left: gapX,
    right: availableX - gapX,
    top: gapY,
    bottom: availableY - gapY
  }
}
export function clampDock(
  point: WindowPoint,
  size: WindowSize,
  viewport: WindowSize
): WindowPoint {
  const bounds = dockBounds(size, viewport)
  return {
    x: Math.max(bounds.left, Math.min(point.x, bounds.right)),
    y: Math.max(bounds.top, Math.min(point.y, bounds.bottom))
  }
}
export function dockEdge(
  point: WindowPoint,
  size: WindowSize,
  viewport: WindowSize
): DockEdge {
  const distances: [Exclude<DockEdge, 'free'>, number][] = [
    ['left', point.x],
    ['top', point.y],
    ['right', viewport.width - point.x - size.width],
    ['bottom', viewport.height - point.y - size.height]
  ]
  distances.sort((a, b) => a[1] - b[1])
  const nearest = distances[0]
  return nearest && nearest[1] <= SNAP_DISTANCE ? nearest[0] : 'free'
}
export function dockPosition(
  point: WindowPoint,
  edge: DockEdge,
  size: WindowSize,
  viewport: WindowSize
): WindowPoint {
  const result = clampDock(point, size, viewport)
  const bounds = dockBounds(size, viewport)
  if (edge === 'left') result.x = bounds.left
  if (edge === 'right') result.x = bounds.right
  if (edge === 'top') result.y = bounds.top
  if (edge === 'bottom') result.y = bounds.bottom
  return result
}
