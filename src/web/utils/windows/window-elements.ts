// DOM references belong to the mounted shell, never to saved preferences.
const windows = new Map<string, HTMLElement>()
const dock = new Map<string, HTMLElement>()
const focusTargets = new Map<string, () => void>()
let pageElement: HTMLElement | null = null

// Applications own their input APIs; the shell never searches their markup.
export function registerWindowFocus(id: string, focus: () => void) {
  focusTargets.set(id, focus)
  return () => {
    if (focusTargets.get(id) === focus) focusTargets.delete(id)
  }
}
export function registerPageElement(element: HTMLElement) {
  pageElement = element
  return () => {
    if (pageElement === element) pageElement = null
  }
}
// Direct manipulation must not start a layout animation.
const gestures = new Set<string>()
// Resource release waits for the visual copy to leave the screen.
const transitions = new Map<string, Promise<void>>()

export function registerWindowElement(id: string, element: HTMLElement) {
  windows.set(id, element)
  return () => {
    if (windows.get(id) === element) windows.delete(id)
  }
}
export function registerDockElement(id: string, element: HTMLElement | null) {
  if (element) {
    dock.set(id, element)
  } else {
    dock.delete(id)
  }
}
export function windowElement(id: string) {
  return windows.get(id)
}
export function dockElement(id: string) {
  return dock.get(id)
}
export function withoutWindowMotion(id: string, action: () => void) {
  gestures.add(id)
  try {
    action()
  } finally {
    gestures.delete(id)
  }
}
export function isWindowGesture(id: string) {
  return gestures.has(id)
}
export function trackWindowTransition(id: string, transition: Promise<void>) {
  transitions.set(id, transition)
  void transition.finally(() => {
    if (transitions.get(id) === transition) transitions.delete(id)
  })
}
export function afterWindowTransition(id: string, release: () => void) {
  const transition = transitions.get(id)
  if (transition) {
    void transition.then(release)
  } else {
    release()
  }
}
export function focusWindow(id: string | null) {
  if (
    typeof document === 'undefined' ||
    document.querySelector('[role="dialog"][aria-modal="true"]')
  )
    return
  const element = id ? windows.get(id) : null
  if (element) {
    const focus = id ? focusTargets.get(id) : undefined
    if (focus) {
      focus()
    } else {
      element.focus({ preventScroll: true })
    }
  } else {
    pageElement?.focus({ preventScroll: true })
  }
}
