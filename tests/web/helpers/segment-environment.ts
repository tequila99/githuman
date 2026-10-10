// DOM test doubles implement only the observer operations used by segments.
/* oxlint-disable typescript/no-unsafe-type-assertion */
export class TestIntersectionObserver {
  static all: TestIntersectionObserver[] = []
  targets = new Set<Element>()
  private callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.options = options
    this.callback = callback
    TestIntersectionObserver.all.push(this)
  }
  observe(element: Element) {
    this.targets.add(element)
  }
  unobserve(element: Element) {
    this.targets.delete(element)
  }
  disconnect() {
    this.targets.clear()
  }
  deliver(element: Element, near: boolean) {
    this.callback(
      [{ target: element, isIntersecting: near } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

export class TestResizeObserver {
  static all: TestResizeObserver[] = []
  targets = new Set<Element>()
  private callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.all.push(this)
  }
  observe(element: Element) {
    this.targets.add(element)
  }
  disconnect() {
    this.targets.clear()
  }
  deliver() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

export function installSegmentObservers() {
  const intersection = globalThis.IntersectionObserver
  const resize = globalThis.ResizeObserver
  TestIntersectionObserver.all = []
  TestResizeObserver.all = []
  globalThis.IntersectionObserver =
    TestIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver
  return () => {
    globalThis.IntersectionObserver = intersection
    globalThis.ResizeObserver = resize
  }
}
