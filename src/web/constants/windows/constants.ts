import type { ResizeEdge } from '@/types/windows/window'

// Stable IDs connect built-in applications to their windows and persisted state.
export const TERMINAL_WINDOW_ID = 'terminal'
// Preview tabs share one window across file and message sources.
export const PREVIEW_WINDOW_ID = 'preview'
// Preview zoom limits keep diagrams and images usable and match restored preferences.
export const PREVIEW_MIN_SCALE = 0.25
// Limit enlargement to four times the natural size.
export const PREVIEW_MAX_SCALE = 4
// Each zoom action changes the scale by 25 percentage points.
export const PREVIEW_SCALE_STEP = 0.25
// Keep window transitions visible without delaying repeated commands.
export const WINDOW_ANIMATION_DURATION_MS = 300
// When true, window transitions run even if the system asks for reduced motion.
export const WINDOW_IGNORE_REDUCED_MOTION = true
// A window from the dock moves fast first and then settles into place.
export const WINDOW_ENTER_EASING = 'cubic-bezier(0.05, 0.7, 0.1, 1)'
// A window to the dock starts slowly and then accelerates out of view.
export const WINDOW_EXIT_EASING = 'cubic-bezier(0.4, 0, 1, 1)'
// A layout change starts immediately and decelerates to the new place.
export const WINDOW_LAYOUT_EASING = 'cubic-bezier(0.2, 0, 0, 1)'
// Window stacking starts above the main application layout.
export const WINDOW_BASE_Z_INDEX = 2500

// A smaller window cannot show a usable terminal and its toolbar.
export const WINDOW_MIN_WIDTH = 240
export const WINDOW_MIN_HEIGHT = 180
// The window stays below the app header, which has this height.
export const WINDOW_TOP = 50

// The same edge names validate saved preferences and describe dock placement.
export const DOCK_EDGES = ['free', 'top', 'right', 'bottom', 'left'] as const

// Every edge and corner has a resize handle.
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
