// Ignore subpixel differences when comparing layout and visual viewport sizes.
const VIEWPORT_SIZE_TOLERANCE_PX = 1
// Small scale rounding errors must not classify the viewport as zoomed.
const VIEWPORT_SCALE_TOLERANCE = 0.05
// Browser chrome changes must not be mistaken for an open keyboard.
const KEYBOARD_MIN_HEIGHT_REDUCTION_PX = 150
// Require a proportional height reduction on taller screens too.
const KEYBOARD_MIN_HEIGHT_REDUCTION_RATIO = 0.2

export interface ViewportMetrics {
  width: number
  height: number
  scale: number
  offsetTop: number
  offsetLeft: number
}

export interface ViewportBaseline {
  width: number
  height: number
  layoutHeight: number
}

export function nextViewportBaseline(
  baseline: ViewportBaseline,
  current: ViewportMetrics,
  editable: boolean,
  layoutHeight: number,
  fullscreen = false
): ViewportBaseline {
  // A matching layout resize uses ordinary scrolling instead of hiding the footer.
  const layoutResize =
    Math.abs(layoutHeight - baseline.layoutHeight) >=
      VIEWPORT_SIZE_TOLERANCE_PX &&
    Math.abs(current.height - layoutHeight) < VIEWPORT_SIZE_TOLERANCE_PX
  if (
    !editable ||
    Math.abs(current.width - baseline.width) >= VIEWPORT_SIZE_TOLERANCE_PX ||
    fullscreen ||
    layoutResize
  ) {
    return { width: current.width, height: current.height, layoutHeight }
  }
  return { ...baseline, layoutHeight }
}

export function viewportKeyboardOpen(
  baseline: Pick<ViewportMetrics, 'width' | 'height'>,
  current: ViewportMetrics,
  editable: boolean
): boolean {
  return (
    editable &&
    Math.abs(current.scale - 1) < VIEWPORT_SCALE_TOLERANCE &&
    Math.abs(current.width - baseline.width) < VIEWPORT_SIZE_TOLERANCE_PX &&
    baseline.height - current.height >=
      Math.max(
        KEYBOARD_MIN_HEIGHT_REDUCTION_PX,
        KEYBOARD_MIN_HEIGHT_REDUCTION_RATIO * baseline.height
      )
  )
}
